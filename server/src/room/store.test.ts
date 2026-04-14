import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import Redis from 'ioredis'
import {
  addMember,
  addPost,
  addReaction,
  createOrTouchRoom,
  flagPost,
  getPublicFeed,
  getRoomSnapshot,
  getRoomState,
  isAlive,
  setRoomState,
  wipeRoom,
} from './store.js'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

let redis: Redis
let redisAvailable = false

function randomKey(prefix = 'test'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`
}

beforeAll(async () => {
  redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  })
  try {
    await redis.connect()
    const pong = await redis.ping()
    redisAvailable = pong === 'PONG'
  } catch {
    redisAvailable = false
    // eslint-disable-next-line no-console
    console.warn('Redis unavailable, skipping store tests')
  }
})

afterAll(async () => {
  try {
    await redis?.quit()
  } catch {
    redis?.disconnect()
  }
})

const createdKeys: string[] = []

afterEach(async () => {
  if (!redisAvailable) return
  while (createdKeys.length) {
    const k = createdKeys.pop()!
    try {
      await wipeRoom(redis, k)
    } catch {
      /* ignore */
    }
  }
})

function track(k: string): string {
  createdKeys.push(k)
  return k
}

describe('room store', () => {
  it('createOrTouchRoom creates meta with state=live and sets alive marker', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    const meta = await createOrTouchRoom(redis, key)
    expect(meta.state).toBe('live')
    expect(meta.createdAt).toBeGreaterThan(0)
    expect(meta.hardExpiresAt).toBeGreaterThan(meta.createdAt)
    expect(await isAlive(redis, key)).toBe(true)
  })

  it('createOrTouchRoom twice preserves createdAt', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    const first = await createOrTouchRoom(redis, key)
    await new Promise((r) => setTimeout(r, 1100))
    const second = await createOrTouchRoom(redis, key)
    expect(second.createdAt).toBe(first.createdAt)
    expect(await isAlive(redis, key)).toBe(true)
  })

  it('addMember + getRoomSnapshot returns the member', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    await createOrTouchRoom(redis, key)
    await addMember(redis, key, 'user-1')
    const snap = await getRoomSnapshot(redis, key)
    expect(snap.memberUserIds).toContain('user-1')
  })

  it('addPost then getPublicFeed returns newest-first with flagCount=0', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    await createOrTouchRoom(redis, key)
    await addPost(redis, key, {
      id: 'p1',
      authorUserId: 'u1',
      type: 'note',
      text: 'hello',
      createdAt: Date.now(),
    })
    await addPost(redis, key, {
      id: 'p2',
      authorUserId: 'u2',
      type: 'question',
      text: 'why?',
      createdAt: Date.now(),
    })
    const feed = await getPublicFeed(redis, key)
    expect(feed).toHaveLength(2)
    expect(feed[0].postId).toBe('p2')
    expect(feed[1].postId).toBe('p1')
    expect(feed[0].flagCount).toBe(0)
    expect(feed[0].reactions).toEqual({})
  })

  it('addReaction shows emoji count in feed', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    await createOrTouchRoom(redis, key)
    await addPost(redis, key, {
      id: 'p1',
      authorUserId: 'u1',
      type: 'note',
      text: 'hi',
      createdAt: Date.now(),
    })
    await addReaction(redis, key, 'p1', 'u2', '🔥')
    await addReaction(redis, key, 'p1', 'u3', '🔥')
    const feed = await getPublicFeed(redis, key)
    expect(feed[0].reactions['🔥']).toBe(2)
  })

  it('user reacting twice with different emojis keeps only the latest', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    await createOrTouchRoom(redis, key)
    await addPost(redis, key, {
      id: 'p1',
      authorUserId: 'u1',
      type: 'note',
      text: 'hi',
      createdAt: Date.now(),
    })
    await addReaction(redis, key, 'p1', 'u2', '🔥')
    await addReaction(redis, key, 'p1', 'u2', '💯')
    const feed = await getPublicFeed(redis, key)
    expect(feed[0].reactions['🔥']).toBeUndefined()
    expect(feed[0].reactions['💯']).toBe(1)
  })

  it('flagPost by one user returns 1; second call by same user still returns 1', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    await createOrTouchRoom(redis, key)
    await addPost(redis, key, {
      id: 'p1',
      authorUserId: 'u1',
      type: 'note',
      text: 'hi',
      createdAt: Date.now(),
    })
    const first = await flagPost(redis, key, 'p1', 'u2')
    const second = await flagPost(redis, key, 'p1', 'u2')
    expect(first).toBe(1)
    expect(second).toBe(1)
  })

  it('three flaggers hides post from feed but keeps it in snapshot', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    await createOrTouchRoom(redis, key)
    await addPost(redis, key, {
      id: 'p1',
      authorUserId: 'u1',
      type: 'note',
      text: 'hi',
      createdAt: Date.now(),
    })
    await flagPost(redis, key, 'p1', 'a')
    await flagPost(redis, key, 'p1', 'b')
    await flagPost(redis, key, 'p1', 'c')
    const feed = await getPublicFeed(redis, key)
    expect(feed).toHaveLength(0)
    const snap = await getRoomSnapshot(redis, key)
    expect(snap.posts.map((p) => p.postId)).toContain('p1')
  })

  it('setRoomState matching -> getRoomState returns matching', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    await createOrTouchRoom(redis, key)
    await setRoomState(redis, key, 'matching')
    expect(await getRoomState(redis, key)).toBe('matching')
  })

  it('wipeRoom removes all room:{key}:* keys', async () => {
    if (!redisAvailable) return
    const key = randomKey()
    await createOrTouchRoom(redis, key)
    await addMember(redis, key, 'u1')
    await addPost(redis, key, {
      id: 'p1',
      authorUserId: 'u1',
      type: 'note',
      text: 'hi',
      createdAt: Date.now(),
    })
    await addReaction(redis, key, 'p1', 'u2', '🔥')
    await flagPost(redis, key, 'p1', 'u3')
    await wipeRoom(redis, key)
    const keys = await redis.keys(`room:${key}:*`)
    expect(keys).toEqual([])
  })

  it('isAlive returns false after the alive key expires', async () => {
    if (!redisAvailable) return
    const key = track(randomKey())
    await createOrTouchRoom(redis, key)
    await redis.expire(`room:${key}:alive`, 1)
    await new Promise((r) => setTimeout(r, 1500))
    expect(await isAlive(redis, key)).toBe(false)
  })
})
