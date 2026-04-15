import type { Redis } from 'ioredis'
import type Anthropic from '@anthropic-ai/sdk'
import { authorHash } from '../room/key.js'
import { getRoomSnapshot } from '../room/store.js'
import {
  CLUSTER_SYSTEM_PROMPT,
  buildPayload,
  buildUserMessage,
  parseClusters,
} from './prompt.js'

const MIN_CLUSTER_SIZE = 2
const MAX_CLUSTER_SIZE = 5

export interface ResolvedCluster {
  clusterId: string
  userIds: string[]
  sharedTheme: string
  roomContext: string
}

export interface ClusterDeps {
  redis: Redis
  anthropic: Anthropic
  persistCluster: (cluster: ResolvedCluster) => Promise<void>
  maxRetries?: number
  backoffMs?: number
  model?: string
}

async function callClaude(
  deps: ClusterDeps,
  userMessage: string,
): Promise<string> {
  const model = deps.model ?? 'claude-opus-4-6'
  const maxRetries = deps.maxRetries ?? 2
  const baseBackoff = deps.backoffMs ?? 500

  let lastError: unknown = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await deps.anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: CLUSTER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      })
      const textBlock = response.content.find(
        (b): b is { type: 'text'; text: string; citations?: unknown } =>
          (b as { type: string }).type === 'text',
      )
      if (!textBlock) throw new Error('no text block in claude response')
      return textBlock.text
    } catch (err) {
      lastError = err
      if (attempt === maxRetries) break
      const delay = baseBackoff * Math.pow(2, attempt)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError ?? new Error('claude call failed')
}

export async function runMatching(
  deps: ClusterDeps,
  roomKey: string,
): Promise<ResolvedCluster[]> {
  const snapshot = await getRoomSnapshot(deps.redis, roomKey)

  if (snapshot.posts.length === 0 || snapshot.memberUserIds.length < 2) {
    return []
  }

  // Build ephemeral hash <-> userId map. This is discarded when the function returns.
  const hashToUserId = new Map<string, string>()
  const userIdToHash = new Map<string, string>()
  for (const userId of snapshot.memberUserIds) {
    const h = authorHash(userId, roomKey)
    hashToUserId.set(h, userId)
    userIdToHash.set(userId, h)
  }

  const payload = buildPayload(snapshot, userIdToHash)
  if (payload.posts.length === 0) return []

  const userMessage = buildUserMessage(payload)

  let rawText: string
  try {
    rawText = await callClaude(deps, userMessage)
  } catch (err) {
    console.error('matching: claude call failed for', roomKey, err)
    return []
  }

  let rawClusters
  try {
    rawClusters = parseClusters(rawText)
  } catch (err) {
    console.error('matching: failed to parse claude output', roomKey, err)
    return []
  }

  const roomContext = summarizePayloadForContext(payload)

  const resolved: ResolvedCluster[] = []
  for (const c of rawClusters) {
    const userIds = new Set<string>()
    for (const hash of c.author_hashes) {
      const uid = hashToUserId.get(hash)
      if (uid) userIds.add(uid)
    }
    if (userIds.size < MIN_CLUSTER_SIZE) continue
    const capped = Array.from(userIds).slice(0, MAX_CLUSTER_SIZE)
    resolved.push({
      clusterId: c.cluster_id,
      userIds: capped,
      sharedTheme: c.shared_theme,
      roomContext,
    })
  }

  for (const cluster of resolved) {
    try {
      await deps.persistCluster(cluster)
    } catch (err) {
      console.error('matching: persistCluster failed', roomKey, err)
    }
  }

  return resolved
}

function summarizePayloadForContext(payload: {
  posts: Array<{ text: string; type: string }>
}): string {
  const count = payload.posts.length
  const byType = payload.posts.reduce<Record<string, number>>((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + 1
    return acc
  }, {})
  const parts = Object.entries(byType).map(([t, n]) => `${n} ${t}`)
  return `Room with ${count} post${count === 1 ? '' : 's'} (${parts.join(', ')})`
}
