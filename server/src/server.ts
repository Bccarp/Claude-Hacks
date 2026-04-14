import http from 'node:http'
import express from 'express'
import cors from 'cors'
import { Server, type Socket } from 'socket.io'
import { env } from './env.js'
import { supabaseAdmin } from './supabaseAdmin.js'
import { redis } from './redis.js'
import { gridCell, roomKey } from './room/key.js'
import {
  createOrTouchRoom,
  addMember,
  removeMember,
  getPublicFeed,
} from './room/store.js'

interface SocketData {
  userId: string
  roomKey: string
}

export function createServer(): {
  httpServer: http.Server
  io: Server
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

    socket.on('disconnect', async () => {
      await removeMember(redis, rk, userId)
    })
  })

  return { httpServer, io }
}
