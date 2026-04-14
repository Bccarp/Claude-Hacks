import type { Server } from 'socket.io'
import type { Redis } from 'ioredis'
import {
  MATCHING_WINDOW_SECONDS,
  isAlive,
  setRoomState,
  wipeRoom,
  type RoomMeta,
  type RoomState,
} from './store.js'

export interface LifecycleDeps {
  io: Server
  redis: Redis
  runMatching: (roomKey: string) => Promise<void>
}

const META_KEY_RE = /^room:(.+):meta$/

async function transitionToMatching(
  deps: LifecycleDeps,
  roomKey: string,
  _meta: RoomMeta,
): Promise<void> {
  const { io, redis } = deps
  await setRoomState(redis, roomKey, 'matching')
  await redis.set(
    `room:${roomKey}:matching_started_at`,
    Date.now().toString(),
    'EX',
    MATCHING_WINDOW_SECONDS + 60,
  )
  io.to(roomKey).emit('room:closing', { sharedTheme: null })
  deps.runMatching(roomKey).catch((err) => {
    console.error('matching failed', roomKey, err)
  })
}

async function wipeAndBroadcast(
  deps: LifecycleDeps,
  roomKey: string,
): Promise<void> {
  const { io, redis } = deps
  io.to(roomKey).emit('room:dead', {})
  await wipeRoom(redis, roomKey)
  io.in(roomKey).disconnectSockets(true)
}

async function collectMetaKeys(redis: Redis): Promise<string[]> {
  const stream = redis.scanStream({ match: 'room:*:meta', count: 100 })
  const keys: string[] = []
  return new Promise((resolve, reject) => {
    stream.on('data', (batch: string[]) => {
      for (const k of batch) keys.push(k)
    })
    stream.on('end', () => {
      resolve(keys)
    })
    stream.on('error', (err) => {
      reject(err)
    })
  })
}

export async function tick(deps: LifecycleDeps): Promise<void> {
  const { redis } = deps
  const keys = await collectMetaKeys(redis)
  const seen = new Set<string>()
  for (const metaKey of keys) {
    const m = META_KEY_RE.exec(metaKey)
    if (!m) continue
    const roomKey = m[1]!
    if (seen.has(roomKey)) continue
    seen.add(roomKey)

    const raw = await redis.hgetall(metaKey)
    if (!raw || !raw.createdAt) continue
    const meta: RoomMeta = {
      createdAt: Number(raw.createdAt),
      hardExpiresAt: Number(raw.hardExpiresAt),
      state: (raw.state as RoomState) ?? 'live',
    }

    if (meta.state === 'dead') continue

    if (meta.state === 'matching') {
      const startedAtStr = await redis.get(
        `room:${roomKey}:matching_started_at`,
      )
      const startedAt = startedAtStr ? Number(startedAtStr) : null
      const expired =
        startedAt === null ||
        Date.now() - startedAt > MATCHING_WINDOW_SECONDS * 1000
      if (expired) {
        await wipeAndBroadcast(deps, roomKey)
      }
      continue
    }

    if (meta.state === 'live') {
      // hardExpiresAt is stored in seconds by the store helper.
      const hardExpiresMs = meta.hardExpiresAt * 1000
      if (Date.now() > hardExpiresMs) {
        await transitionToMatching(deps, roomKey, meta)
        continue
      }
      const alive = await isAlive(redis, roomKey)
      if (!alive) {
        await transitionToMatching(deps, roomKey, meta)
        continue
      }
    }
  }
}

export function startLifecycleTicker(
  deps: LifecycleDeps,
  intervalMs: number = 30_000,
): () => void {
  const handle = setInterval(() => {
    tick(deps).catch((err) => {
      console.error('lifecycle tick error', err)
    })
  }, intervalMs)
  return () => {
    clearInterval(handle)
  }
}
