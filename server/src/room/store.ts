import type { Redis } from 'ioredis'

export const IDLE_TTL_SECONDS = 1800 // 30 min
export const HARD_TTL_SECONDS = 10800 // 3 hours
export const MATCHING_WINDOW_SECONDS = 900 // 15 min
export const FLAG_HIDE_THRESHOLD = 3

export type PostType = 'question' | 'note'
export type RoomState = 'live' | 'matching' | 'dead'

export interface StoredPost {
  id: string
  authorUserId: string
  type: PostType
  text: string
  createdAt: number
  flagCount: number
}

export interface PublicPost {
  postId: string
  type: PostType
  text: string
  reactions: Record<string, number>
  flagCount: number
  createdAt: number
}

export interface RoomMeta {
  createdAt: number
  hardExpiresAt: number
  state: RoomState
}

export interface RoomSnapshot {
  posts: Array<{
    postId: string
    authorUserId: string
    type: PostType
    text: string
    createdAt: number
  }>
  reactions: Array<{ postId: string; userId: string; emoji: string }>
  memberUserIds: string[]
}

// --- key helpers ---
const kMeta = (r: string) => `room:${r}:meta`
const kAlive = (r: string) => `room:${r}:alive`
const kPosts = (r: string) => `room:${r}:posts`
const kPost = (r: string, id: string) => `room:${r}:post:${id}`
const kFlaggers = (r: string, id: string) => `room:${r}:post:${id}:flaggers`
const kReactions = (r: string, id: string) => `room:${r}:reactions:${id}`
const kMembers = (r: string) => `room:${r}:members`

async function refreshAlive(redis: Redis, roomKey: string): Promise<void> {
  await redis.set(kAlive(roomKey), '1', 'EX', IDLE_TTL_SECONDS)
  // Refresh hard expire on meta (floor at IDLE_TTL for safety)
  const meta = await redis.hgetall(kMeta(roomKey))
  if (meta && meta.hardExpiresAt) {
    const now = Math.floor(Date.now() / 1000)
    const remaining = Number(meta.hardExpiresAt) - now
    const ttl = Math.max(remaining, IDLE_TTL_SECONDS)
    if (ttl > 0) {
      await redis.expire(kMeta(roomKey), ttl)
    }
  }
}

export async function createOrTouchRoom(
  redis: Redis,
  roomKey: string,
): Promise<RoomMeta> {
  const metaKey = kMeta(roomKey)
  const existing = await redis.hgetall(metaKey)
  let meta: RoomMeta
  if (!existing || !existing.createdAt) {
    const now = Math.floor(Date.now() / 1000)
    const hardExpiresAt = now + HARD_TTL_SECONDS
    meta = { createdAt: now, hardExpiresAt, state: 'live' }
    await redis.hset(metaKey, {
      createdAt: String(now),
      hardExpiresAt: String(hardExpiresAt),
      state: 'live',
    })
    await redis.expire(metaKey, HARD_TTL_SECONDS)
  } else {
    meta = {
      createdAt: Number(existing.createdAt),
      hardExpiresAt: Number(existing.hardExpiresAt),
      state: (existing.state as RoomState) ?? 'live',
    }
  }
  await refreshAlive(redis, roomKey)
  return meta
}

export async function addMember(
  redis: Redis,
  roomKey: string,
  userId: string,
): Promise<void> {
  await redis.sadd(kMembers(roomKey), userId)
  await refreshAlive(redis, roomKey)
}

export async function removeMember(
  redis: Redis,
  roomKey: string,
  userId: string,
): Promise<void> {
  await redis.srem(kMembers(roomKey), userId)
}

export async function addPost(
  redis: Redis,
  roomKey: string,
  post: {
    id: string
    authorUserId: string
    type: PostType
    text: string
    createdAt: number
  },
): Promise<void> {
  await redis.hset(kPost(roomKey, post.id), {
    id: post.id,
    authorUserId: post.authorUserId,
    type: post.type,
    text: post.text,
    createdAt: String(post.createdAt),
    flagCount: '0',
  })
  await redis.lpush(kPosts(roomKey), post.id)
  await refreshAlive(redis, roomKey)
}

export async function addReaction(
  redis: Redis,
  roomKey: string,
  postId: string,
  userId: string,
  emoji: string,
): Promise<void> {
  await redis.hset(kReactions(roomKey, postId), userId, emoji)
  await refreshAlive(redis, roomKey)
}

export async function flagPost(
  redis: Redis,
  roomKey: string,
  postId: string,
  userId: string,
): Promise<number> {
  const added = await redis.sadd(kFlaggers(roomKey, postId), userId)
  if (added === 1) {
    const count = await redis.hincrby(kPost(roomKey, postId), 'flagCount', 1)
    return count
  }
  const current = await redis.hget(kPost(roomKey, postId), 'flagCount')
  return Number(current ?? 0)
}

export async function getPublicFeed(
  redis: Redis,
  roomKey: string,
): Promise<PublicPost[]> {
  const ids = await redis.lrange(kPosts(roomKey), 0, -1)
  const out: PublicPost[] = []
  for (const id of ids) {
    const h = await redis.hgetall(kPost(roomKey, id))
    if (!h || !h.id) continue
    const flagCount = Number(h.flagCount ?? 0)
    if (flagCount >= FLAG_HIDE_THRESHOLD) continue
    const rx = await redis.hgetall(kReactions(roomKey, id))
    const reactions: Record<string, number> = {}
    for (const emoji of Object.values(rx)) {
      reactions[emoji] = (reactions[emoji] ?? 0) + 1
    }
    out.push({
      postId: id,
      type: h.type as PostType,
      text: h.text,
      reactions,
      flagCount,
      createdAt: Number(h.createdAt),
    })
  }
  return out
}

export async function getRoomSnapshot(
  redis: Redis,
  roomKey: string,
): Promise<RoomSnapshot> {
  const ids = await redis.lrange(kPosts(roomKey), 0, -1)
  const posts: RoomSnapshot['posts'] = []
  const reactions: RoomSnapshot['reactions'] = []
  for (const id of ids) {
    const h = await redis.hgetall(kPost(roomKey, id))
    if (!h || !h.id) continue
    posts.push({
      postId: id,
      authorUserId: h.authorUserId,
      type: h.type as PostType,
      text: h.text,
      createdAt: Number(h.createdAt),
    })
    const rx = await redis.hgetall(kReactions(roomKey, id))
    for (const [userId, emoji] of Object.entries(rx)) {
      reactions.push({ postId: id, userId, emoji })
    }
  }
  const memberUserIds = await redis.smembers(kMembers(roomKey))
  return { posts, reactions, memberUserIds }
}

export async function wipeRoom(redis: Redis, roomKey: string): Promise<void> {
  const pattern = `room:${roomKey}:*`
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100,
    )
    cursor = next
    if (keys.length > 0) {
      await redis.unlink(...keys)
    }
  } while (cursor !== '0')
}

export async function getRoomState(
  redis: Redis,
  roomKey: string,
): Promise<RoomState | null> {
  const s = await redis.hget(kMeta(roomKey), 'state')
  return (s as RoomState | null) ?? null
}

export async function setRoomState(
  redis: Redis,
  roomKey: string,
  state: RoomState,
): Promise<void> {
  await redis.hset(kMeta(roomKey), 'state', state)
}

export async function isAlive(
  redis: Redis,
  roomKey: string,
): Promise<boolean> {
  const exists = await redis.exists(kAlive(roomKey))
  return exists === 1
}
