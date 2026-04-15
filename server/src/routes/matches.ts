import { Router } from 'express'
import { z, ZodError } from 'zod'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js'

const interestSchema = z.object({
  targetUserId: z.string().uuid(),
})

export function matchesRouter(): Router {
  const router = Router()

  router.use(requireAuth)

  router.get('/', async (req, res) => {
    const userId = (req as AuthedRequest).userId
    const nowIso = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('match_candidates')
      .select('id, user_ids, shared_theme, room_context, created_at, expires_at')
      .contains('user_ids', [userId])
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ matches: data ?? [] })
  })

  router.post('/:id/interest', async (req, res) => {
    const userId = (req as AuthedRequest).userId
    const matchId = req.params.id
    let body: z.infer<typeof interestSchema>
    try {
      body = interestSchema.parse(req.body)
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'invalid_payload' })
        return
      }
      throw err
    }

    if (body.targetUserId === userId) {
      res.status(400).json({ error: 'cannot_target_self' })
      return
    }

    const { data: match, error: matchErr } = await supabaseAdmin
      .from('match_candidates')
      .select('id, user_ids, expires_at')
      .eq('id', matchId)
      .maybeSingle()
    if (matchErr) {
      res.status(500).json({ error: matchErr.message })
      return
    }
    if (!match) {
      res.status(404).json({ error: 'match_not_found' })
      return
    }
    const ids = match.user_ids as string[]
    if (!ids.includes(userId) || !ids.includes(body.targetUserId)) {
      res.status(403).json({ error: 'not_a_member_of_match' })
      return
    }
    if (new Date(match.expires_at).getTime() <= Date.now()) {
      res.status(410).json({ error: 'match_expired' })
      return
    }

    const { error: insertErr } = await supabaseAdmin
      .from('reveal_requests')
      .insert({
        match_id: matchId,
        from_user: userId,
        to_user: body.targetUserId,
      })
    if (insertErr && !/duplicate key/i.test(insertErr.message)) {
      res.status(500).json({ error: insertErr.message })
      return
    }

    res.status(201).json({ ok: true })
  })

  router.delete('/:id', async (req, res) => {
    const userId = (req as AuthedRequest).userId
    const matchId = req.params.id
    const { data: match, error: matchErr } = await supabaseAdmin
      .from('match_candidates')
      .select('user_ids')
      .eq('id', matchId)
      .maybeSingle()
    if (matchErr) {
      res.status(500).json({ error: matchErr.message })
      return
    }
    if (!match) {
      res.status(404).json({ error: 'match_not_found' })
      return
    }
    if (!(match.user_ids as string[]).includes(userId)) {
      res.status(403).json({ error: 'not_a_member_of_match' })
      return
    }
    const { error: delErr } = await supabaseAdmin
      .from('match_candidates')
      .delete()
      .eq('id', matchId)
    if (delErr) {
      res.status(500).json({ error: delErr.message })
      return
    }
    res.status(204).end()
  })

  return router
}
