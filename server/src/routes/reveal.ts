import { Router } from 'express'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js'

export function revealRouter(): Router {
  const router = Router()

  router.use(requireAuth)

  router.get('/:id/reveal/:otherUserId', async (req, res) => {
    const userId = (req as AuthedRequest).userId
    const { id: matchId, otherUserId } = req.params

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
    const ids = match.user_ids as string[]
    if (!ids.includes(userId) || !ids.includes(otherUserId)) {
      res.status(403).json({ error: 'not_a_member_of_match' })
      return
    }

    const { data: reqs, error: reqErr } = await supabaseAdmin
      .from('reveal_requests')
      .select('from_user, to_user')
      .eq('match_id', matchId)
      .or(
        `and(from_user.eq.${userId},to_user.eq.${otherUserId}),and(from_user.eq.${otherUserId},to_user.eq.${userId})`,
      )
    if (reqErr) {
      res.status(500).json({ error: reqErr.message })
      return
    }

    const mine = (reqs ?? []).some(
      (r) => r.from_user === userId && r.to_user === otherUserId,
    )
    const theirs = (reqs ?? []).some(
      (r) => r.from_user === otherUserId && r.to_user === userId,
    )

    if (!mine) {
      res.status(400).json({ error: 'interest_not_declared' })
      return
    }
    if (!theirs) {
      res.status(202).json({ status: 'pending' })
      return
    }

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, avatar_animal, avatar_color, contact_handle')
      .in('id', [userId, otherUserId])
    if (profErr) {
      res.status(500).json({ error: profErr.message })
      return
    }
    const me = (profiles ?? []).find((p) => p.id === userId)
    const them = (profiles ?? []).find((p) => p.id === otherUserId)
    if (!me || !them) {
      res.status(404).json({ error: 'profile_not_found' })
      return
    }

    res.json({ status: 'revealed', me, them })
  })

  return router
}
