import { Router } from 'express'
import { z, ZodError } from 'zod'
import { supabaseAdmin } from '../supabaseAdmin.js'
import { randomAvatar } from '../avatar.js'

const signupSchema = z.object({
  name: z.string().min(1).max(40),
  email: z.string().email(),
  password: z.string().min(6),
})

export function authRouter(): Router {
  const router = Router()

  router.post('/signup', async (req, res) => {
    try {
      const { name, email, password } = signupSchema.parse(req.body)

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (error) {
        res.status(400).json({ error: error.message })
        return
      }

      const avatar = randomAvatar()
      const { error: profileError } = await supabaseAdmin.rpc('create_profile', {
        p_id: data.user.id,
        p_display_name: name.trim(),
        p_avatar_animal: avatar.animal,
        p_avatar_color: avatar.color,
      })

      if (profileError) {
        await supabaseAdmin.auth.admin.deleteUser(data.user.id)
        res.status(500).json({ error: profileError.message })
        return
      }

      res.json({ ok: true })
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: err.errors[0]?.message ?? 'Invalid input' })
        return
      }
      console.error('signup error', err)
      res.status(500).json({ error: 'Server error' })
    }
  })

  return router
}
