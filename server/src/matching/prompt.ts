import type { RoomSnapshot } from '../room/store.js'

export interface PromptPost {
  post_id: string
  author: string
  type: string
  text: string
}

export interface PromptReaction {
  post_id: string
  author: string
  emoji: string
}

export interface PromptPayload {
  posts: PromptPost[]
  reactions: PromptReaction[]
}

export interface RawCluster {
  cluster_id: string
  author_hashes: string[]
  shared_theme: string
}

export const CLUSTER_SYSTEM_PROMPT = `You are matching anonymous participants in a shared-proximity study/work room based on the public messages they posted.

Output requirements:
- Return ONLY a JSON array. No prose, no markdown fences, no commentary.
- Each element must be of the shape: {"cluster_id": string, "author_hashes": string[], "shared_theme": string}
- Each cluster must have at least 2 and at most 5 distinct author_hashes.
- Only use author_hashes that appear in the input. Do NOT invent hashes.
- Prefer clusters whose members share both topical themes AND co-reactions (one reacted to another's post, or both reacted to a third post).
- If no meaningful clusters exist, return an empty array: []
- shared_theme should be a short human-readable phrase (<= 80 chars) describing the common interest.`

export function buildPayload(
  snapshot: RoomSnapshot,
  userIdToHash: Map<string, string>,
): PromptPayload {
  const posts: PromptPost[] = []
  for (const p of snapshot.posts) {
    const hash = userIdToHash.get(p.authorUserId)
    if (!hash) continue
    posts.push({
      post_id: p.postId,
      author: hash,
      type: p.type,
      text: p.text,
    })
  }
  const reactions: PromptReaction[] = []
  for (const r of snapshot.reactions) {
    const hash = userIdToHash.get(r.userId)
    if (!hash) continue
    reactions.push({
      post_id: r.postId,
      author: hash,
      emoji: r.emoji,
    })
  }
  return { posts, reactions }
}

export function buildUserMessage(payload: PromptPayload): string {
  return `Cluster the following anonymous participants. Input:\n${JSON.stringify(
    payload,
    null,
    2,
  )}`
}

export function parseClusters(raw: string): RawCluster[] {
  const text = raw.trim()
  // Tolerate accidental code fences
  let body = text
  if (body.startsWith('```')) {
    body = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }
  // Find the first JSON array in the string as a fallback.
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON array found in model output')
  }
  const slice = body.slice(start, end + 1)
  const parsed = JSON.parse(slice)
  if (!Array.isArray(parsed)) {
    throw new Error('model output is not a JSON array')
  }
  const clusters: RawCluster[] = []
  for (const item of parsed) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.cluster_id === 'string' &&
      typeof item.shared_theme === 'string' &&
      Array.isArray(item.author_hashes) &&
      item.author_hashes.every((h: unknown) => typeof h === 'string')
    ) {
      clusters.push({
        cluster_id: item.cluster_id,
        author_hashes: item.author_hashes as string[],
        shared_theme: item.shared_theme,
      })
    }
  }
  return clusters
}
