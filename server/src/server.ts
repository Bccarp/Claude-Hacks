import http from 'node:http'
import { randomUUID } from 'node:crypto'
import express from 'express'
import cors from 'cors'
import { Server, type Socket } from 'socket.io'
import { z, ZodError } from 'zod'
import { env } from './env.js'
import { supabaseAdmin } from './supabaseAdmin.js'
import { redis } from './redis.js'
import { gridCell, roomKey } from './room/key.js'
import {
  createOrTouchRoom,
  addMember,
  removeMember,
  addPost,
  addReaction,
  flagPost,
  getPublicFeed,
  getReactionCounts,
  getRoomState,
  ALLOWED_REACTIONS,
  FLAG_HIDE_THRESHOLD,
  type PublicPost,
} from './room/store.js'
import { startLifecycleTicker } from './room/lifecycle.js'

const postNewSchema = z.object({
  type: z.enum(['question', 'note']),
  text: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(280)),
})

const reactionAddSchema = z.object({
  postId: z.string().min(1),
  emoji: z.enum(ALLOWED_REACTIONS),
})

const postFlagSchema = z.object({
  postId: z.string().min(1),
})

interface SocketData {
  userId: string
  roomKey: string
}

export function createServer(): {
  httpServer: http.Server
  io: Server
  stopTicker: () => void
} {
  const app = express()
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }))
  app.use(express.json())

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true })
  })

  const httpServer = http.createServer(app)
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  })

  io.use(async (socket: Socket, next) => {
    try {
      const auth = socket.handshake.auth as {
        token?: string
        lat?: unknown
        lng?: unknown
        code?: unknown
      }
      const token = auth.token
      if (!token) {
        next(new Error('unauthorized'))
        return
      }

      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !data.user) {
        next(new Error('unauthorized'))
        return
      }
      const user = data.user

      const xff = socket.handshake.headers['x-forwarded-for']
      let ip: string
      if (typeof xff === 'string' && xff.length > 0) {
        ip = xff.split(',')[0]!.trim()
      } else if (Array.isArray(xff) && xff.length > 0) {
        ip = xff[0]!.split(',')[0]!.trim()
      } else {
        ip = socket.handshake.address
      }

      let key: string | null = null
      if (typeof auth.lat === 'number' && typeof auth.lng === 'number') {
        const cell = gridCell(auth.lat, auth.lng)
        key = roomKey(cell, ip)
      } else if (
        typeof auth.code === 'string' &&
        /^\d{6}$/.test(auth.code)
      ) {
        key = roomKey('code', auth.code)
      }

      if (!key) {
        next(new Error('proximity unavailable'))
        return
      }

      const sockData: SocketData = { userId: user.id, roomKey: key }
      socket.data = sockData
      next()
    } catch (_err) {
      next(new Error('unauthorized'))
    }
  })

  io.on('connection', async (socket: Socket) => {
    const { userId, roomKey: rk } = socket.data as SocketData
    await createOrTouchRoom(redis, rk)
    await addMember(redis, rk, userId)
    await socket.join(rk)

    const feed = await getPublicFeed(redis, rk)
    socket.emit('room:state', { feed, meta: { state: 'live' } })

    socket.on('post:new', async (payload: unknown) => {
      try {
        const { type, text } = postNewSchema.parse(payload)
        const state = await getRoomState(redis, rk)
        if (state !== 'live') {
          socket.emit('error', { code: 'room_not_live' })
          return
        }
        const postId = randomUUID()
        const createdAt = Date.now()
        await addPost(redis, rk, {
          id: postId,
          authorUserId: userId,
          type,
          text,
          createdAt,
        })
        const publicPost: PublicPost = {
          postId,
          type,
          text,
          reactions: {},
          flagCount: 0,
          createdAt,
        }
        io.to(rk).emit('post:new', publicPost)
        socket.emit('post:ack', { postId })
      } catch (err) {
        if (err instanceof ZodError) {
          socket.emit('error', { code: 'invalid_payload', event: 'post:new' })
          return
        }
        console.error('post:new error', err)
        socket.emit('error', { code: 'server_error' })
      }
    })

    socket.on('reaction:add', async (payload: unknown) => {
      try {
        const { postId, emoji } = reactionAddSchema.parse(payload)
        const state = await getRoomState(redis, rk)
        if (state !== 'live') {
          socket.emit('error', { code: 'room_not_live' })
          return
        }
        await addReaction(redis, rk, postId, userId, emoji)
        const reactions = await getReactionCounts(redis, rk, postId)
        io.to(rk).emit('reaction:update', { postId, reactions })
      } catch (err) {
        if (err instanceof ZodError) {
          socket.emit('error', {
            code: 'invalid_payload',
            event: 'reaction:add',
          })
          return
        }
        console.error('reaction:add error', err)
        socket.emit('error', { code: 'server_error' })
      }
    })

    socket.on('post:flag', async (payload: unknown) => {
      try {
        const { postId } = postFlagSchema.parse(payload)
        const state = await getRoomState(redis, rk)
        if (state !== 'live') {
          socket.emit('error', { code: 'room_not_live' })
          return
        }
        const count = await flagPost(redis, rk, postId, userId)
        if (count >= FLAG_HIDE_THRESHOLD) {
          io.to(rk).emit('post:hidden', { postId })
        }
      } catch (err) {
        if (err instanceof ZodError) {
          socket.emit('error', { code: 'invalid_payload', event: 'post:flag' })
          return
        }
        console.error('post:flag error', err)
        socket.emit('error', { code: 'server_error' })
      }
    })

    socket.on('disconnect', async () => {
      await removeMember(redis, rk, userId)
    })
  })

  const stopTicker = startLifecycleTicker({
    io,
    redis,
    runMatching: async (roomKey: string) => {
      // Task 6 will replace this with the real Claude clustering job.
      console.log('runMatching stub called for', roomKey)
    },
  })

  return { httpServer, io, stopTicker }
}
