import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Redis } from 'ioredis'
import { runMatching, type ClusterDeps, type ResolvedCluster } from './cluster.js'
import {
  createOrTouchRoom,
  addMember,
  addPost,
  addReaction,
  wipeRoom,
} from '../room/store.js'
import { authorHash } from '../room/key.js'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

function makeAnthropicStub(responseJson: string) {
  const seenPrompts: Array<{ system?: string; user: string }> = []
  const client = {
    messages: {
      create: vi.fn(async (req: {
        system?: string
        messages: Array<{ role: string; content: string }>
      }) => {
        seenPrompts.push({
          system: req.system,
          user: req.messages[0]!.content,
        })
        return {
          content: [{ type: 'text', text: responseJson }],
          stop_reason: 'end_turn',
        }
      }),
    },
  }
  return { client, seenPrompts }
}

describe('runMatching', () => {
  let redis: Redis
  const roomKey = 'test-matching-room-key'

  beforeEach(async () => {
    redis = new Redis(REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 })
    await wipeRoom(redis, roomKey)
  })

  afterEach(async () => {
    await wipeRoom(redis, roomKey)
    await redis.quit()
  })

  it('clusters users via their hashes and resolves back to user ids', async () => {
    const alice = '11111111-1111-1111-1111-111111111111'
    const bob = '22222222-2222-2222-2222-222222222222'
    const carol = '33333333-3333-3333-3333-333333333333'

    await createOrTouchRoom(redis, roomKey)
    await addMember(redis, roomKey, alice)
    await addMember(redis, roomKey, bob)
    await addMember(redis, roomKey, carol)

    await addPost(redis, roomKey, {
      id: 'p1',
      authorUserId: alice,
      type: 'question',
      text: 'Anyone want to study linear algebra?',
      createdAt: 1,
    })
    await addPost(redis, roomKey, {
      id: 'p2',
      authorUserId: bob,
      type: 'note',
      text: 'I am working through linear algebra right now',
      createdAt: 2,
    })
    await addPost(redis, roomKey, {
      id: 'p3',
      authorUserId: carol,
      type: 'note',
      text: 'Cooking a thai curry tonight',
      createdAt: 3,
    })
    await addReaction(redis, roomKey, 'p1', bob, '🙌')

    const aliceHash = authorHash(alice, roomKey)
    const bobHash = authorHash(bob, roomKey)
    const carolHash = authorHash(carol, roomKey)

    const claudeResponse = JSON.stringify([
      {
        cluster_id: 'c1',
        author_hashes: [aliceHash, bobHash],
        shared_theme: 'Linear algebra study partners',
      },
      {
        cluster_id: 'c2',
        author_hashes: [carolHash],
        shared_theme: 'Cooking (skip — too small)',
      },
    ])

    const { client, seenPrompts } = makeAnthropicStub(claudeResponse)
    const persisted: ResolvedCluster[] = []

    const deps: ClusterDeps = {
      redis,
      anthropic: client as unknown as ClusterDeps['anthropic'],
      persistCluster: async (c) => {
        persisted.push(c)
      },
    }

    const result = await runMatching(deps, roomKey)

    expect(result).toHaveLength(1)
    expect(result[0]!.sharedTheme).toBe('Linear algebra study partners')
    expect(result[0]!.userIds.sort()).toEqual([alice, bob].sort())

    expect(persisted).toHaveLength(1)
    expect(persisted[0]!.userIds.sort()).toEqual([alice, bob].sort())

    // Ensure no raw user ids leaked into the prompt
    for (const p of seenPrompts) {
      expect(p.user).not.toContain(alice)
      expect(p.user).not.toContain(bob)
      expect(p.user).not.toContain(carol)
    }
    expect(seenPrompts[0]!.user).toContain(aliceHash)
    expect(seenPrompts[0]!.user).toContain(bobHash)
  })

  it('drops clusters with fewer than 2 resolved users', async () => {
    const alice = '11111111-1111-1111-1111-111111111111'
    const bob = '22222222-2222-2222-2222-222222222222'
    await createOrTouchRoom(redis, roomKey)
    await addMember(redis, roomKey, alice)
    await addMember(redis, roomKey, bob)
    await addPost(redis, roomKey, {
      id: 'p1',
      authorUserId: alice,
      type: 'note',
      text: 'hi',
      createdAt: 1,
    })

    const response = JSON.stringify([
      {
        cluster_id: 'c1',
        author_hashes: [authorHash(alice, roomKey), 'deadbeef'],
        shared_theme: 'one real user + one unknown',
      },
    ])

    const { client } = makeAnthropicStub(response)
    const persisted: ResolvedCluster[] = []
    const result = await runMatching(
      {
        redis,
        anthropic: client as unknown as ClusterDeps['anthropic'],
        persistCluster: async (c) => {
          persisted.push(c)
        },
      },
      roomKey,
    )

    expect(result).toEqual([])
    expect(persisted).toEqual([])
  })

  it('retries on failure and eventually returns empty', async () => {
    await createOrTouchRoom(redis, roomKey)
    await addMember(redis, roomKey, 'u1')
    await addPost(redis, roomKey, {
      id: 'p1',
      authorUserId: 'u1',
      type: 'note',
      text: 'hi',
      createdAt: 1,
    })

    const create = vi.fn(async () => {
      throw new Error('boom')
    })
    const client = { messages: { create } } as unknown as ClusterDeps['anthropic']

    const result = await runMatching(
      {
        redis,
        anthropic: client,
        persistCluster: async () => {},
        maxRetries: 2,
        backoffMs: 1,
      },
      roomKey,
    )

    expect(result).toEqual([])
    expect(create).toHaveBeenCalledTimes(3) // initial + 2 retries
  })
})
