import type { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../supabaseAdmin.js'

export interface AuthedRequest extends Request {
  userId: string
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  const token = header.slice('Bearer '.length).trim()
  if (!token) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !data.user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    ;(req as AuthedRequest).userId = data.user.id
    next()
  } catch {
    res.status(401).json({ error: 'unauthorized' })
  }
}
