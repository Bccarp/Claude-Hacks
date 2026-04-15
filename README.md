# Proximate

A proximity-based anonymous-connection PWA. People in the same physical space auto-join an ephemeral room, exchange anonymous questions and notes, and — after the room closes — Claude clusters compatible strangers into match candidates. A bilateral reveal flow exchanges names and contact handles only when both sides opt in.

## Architecture

```
client (Vite + React)  ──http/websocket──▶  server (Express + Socket.io)
        │                                            │
        │                                            ├──▶ Redis  (live room state, TTLs)
        │                                            ├──▶ Supabase Postgres  (profiles, matches, reveal requests)
        │                                            └──▶ Claude API  (clustering)
        │
        └──────────────(Supabase Auth JS)─────────▶  Supabase Auth
```

Monorepo with npm workspaces: `client/` (Vite + React 18 + TS + Tailwind) and `server/` (Node 20 + Express + Socket.io + ioredis + Anthropic SDK).

## Tech stack

- **Server** — Node 20, Express, Socket.io, ioredis, `@supabase/supabase-js`, `@anthropic-ai/sdk`, Zod, Vitest, `tsx watch`
- **Client** — Vite, React 18, TypeScript, Tailwind, `socket.io-client`, `@supabase/supabase-js`, `react-router-dom`
- **Infra** — Redis 7 (rooms + TTLs), Supabase (auth + Postgres), Claude (`claude-opus-4-6`) for clustering

## Prerequisites

- Node 20+
- Redis 7 (Docker via `docker-compose.yml`, or local Homebrew install)
- A Supabase project
- An Anthropic API key

## Environment

Create `.env` at the repo root with:

```
# Server
PORT=4000
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ANTHROPIC_API_KEY=<anthropic key>
CLIENT_ORIGIN=http://localhost:5173

# Client (also readable from client/.env)
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_SERVER_URL=http://localhost:4000
```

Because Vite only reads env files from its own directory, the client copy also needs to live at `client/.env` (the same `VITE_*` vars). The server also looks for `server/.env` via `dotenv/config`; if you keep secrets in the root `.env`, copy or symlink it into each workspace before starting the dev servers.

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only — it bypasses RLS.

## Supabase setup

1. Create a new Supabase project and grab `SUPABASE_URL`, the `service_role` key, and the `anon` key.
2. Open the SQL editor and run `server/supabase/schema.sql`. This creates `profiles`, `match_candidates`, `reveal_requests`, indexes, and RLS policies.
3. Run the `create_profile` RPC migration — it lets the server insert profiles inside the database (avoiding PostgREST timing quirks right after `auth.admin.createUser`):

   ```sql
   CREATE OR REPLACE FUNCTION create_profile(
     p_id uuid,
     p_display_name text,
     p_avatar_animal text,
     p_avatar_color text
   ) RETURNS void
   LANGUAGE plpgsql
   SECURITY DEFINER
   AS $$
   BEGIN
     INSERT INTO public.profiles (id, display_name, avatar_animal, avatar_color, contact_handle)
     VALUES (p_id, p_display_name, p_avatar_animal, p_avatar_color, null)
     ON CONFLICT (id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           avatar_animal = EXCLUDED.avatar_animal,
           avatar_color = EXCLUDED.avatar_color;
   END;
   $$;
   ```

4. In **Authentication → Providers → Email**, turn off "Confirm email" (the server provisions users with `email_confirm: true`, so no verification email is needed).

### Database schema

| Table              | Purpose                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `profiles`         | One row per user. `id` references `auth.users(id)` with `ON DELETE CASCADE`. Stores display name, animal+color avatar, optional contact handle. |
| `match_candidates` | One row per Claude-clustered group. `user_ids uuid[]` (GIN indexed), `shared_theme`, `room_context`, `expires_at` (72h TTL). |
| `reveal_requests`  | `(match_id, from_user, to_user)` unique. Records "I want to reveal myself to this user in this match." Cascade-deletes with the match. |

RLS is on for all three:
- `profiles` — any authenticated user can read; users can only insert/update their own row.
- `match_candidates` / `reveal_requests` — **no policies**, so only the server's service-role key touches them.

## Auth flow

Email confirmation is disabled. Signups are a single-form flow collecting name, email, and password.

```
[Login.tsx]
    │
    │  POST /api/auth/signup  { name, email, password }
    ▼
[server/routes/auth.ts]
    │
    │  supabaseAdmin.auth.admin.createUser({
    │    email, password, email_confirm: true
    │  })
    │
    │  supabaseAdmin.rpc('create_profile', { p_id, p_display_name, ... })
    │
    │  (rolls back the auth user if profile insert fails)
    ▼
[Login.tsx]
    │
    │  supabase.auth.signInWithPassword({ email, password })
    ▼
[AuthProvider]  picks up the session → fetches profile → renders Room
```

Returning users click "Sign in" and hit `signInWithPassword` directly.

The client-side `AuthProvider` (`client/src/lib/auth.tsx`) subscribes to `supabase.auth.onAuthStateChange` and keeps `{ session, profile }` in React context. `RequireAuth` in `App.tsx` gates every route except `/login`.

## How it works

### Rooms & proximity

On socket connect, the server computes the room key from the handshake auth payload:

- **Geo mode:** `gridCell(lat, lng) = round(lat / 0.00015) : round(lng / 0.00015)` → a ~16.7 m latitude bucket. The room key is `sha256(cell || publicIP)`. Same ~15 m bucket + same public egress IP → same room.
- **Code mode:** If geolocation is denied/unavailable, the client shows a 6-digit code form. The room key becomes `sha256("code" || code)` and IP doesn't factor in. The active code is displayed in the header so the creator can share it.

Room state lives entirely in Redis:

| Key                                  | Type  | Purpose                                       |
| ------------------------------------ | ----- | --------------------------------------------- |
| `room:<rk>:meta`                     | hash  | `createdAt`, `hardExpiresAt`, `state`         |
| `room:<rk>:alive`                    | str   | Touched on every action; idle TTL marker      |
| `room:<rk>:members`                  | set   | User IDs currently in the room                |
| `room:<rk>:posts`                    | list  | Post IDs (lpush for newest-first)             |
| `room:<rk>:post:<id>`                | hash  | Post body + `flagCount`                       |
| `room:<rk>:post:<id>:flaggers`       | set   | Users who've flagged                          |
| `room:<rk>:reactions:<postId>`       | hash  | `userId → emoji` (one reaction per user)      |
| `room:<rk>:matching_started_at`      | str   | Timestamp of matching phase start             |

Idle TTL: **30 min**. Hard TTL: **3 hours**. Matching window: **15 min**.

### Socket events

Client → server:
- `post:new { type: 'question'|'note', text }` — 1..280 chars
- `reaction:add { postId, emoji }` — emoji must be one of `😕 🔥 👍 🤔 🙌`
- `post:flag { postId }` — 3 flags hides the post from the public feed

Server → client:
- `room:state { feed, meta }` — emitted on join
- `post:new` — broadcast when anyone posts
- `reaction:update { postId, reactions }`
- `post:hidden { postId }` — when flag threshold is crossed
- `room:closing` — transition to matching; clients render the closing overlay
- `room:dead` — wipe complete; clients navigate to `/matches`
- `error { code, event? }`

All payloads are Zod-validated on the server.

### Lifecycle ticker

A 30-second interval scans `room:*:meta` keys and transitions each room:

- `live` → `matching` when either the idle TTL lapses (no `:alive` key) or `hardExpiresAt` is reached. Sets state, stamps `matching_started_at`, broadcasts `room:closing`, and kicks off `runMatching()` in the background.
- `matching` → `dead` after the 15-minute matching window. Broadcasts `room:dead`, runs `wipeRoom()` (SCAN + UNLINK for `room:<rk>:*`), and disconnects all sockets.

### Matching pipeline

`server/src/matching/cluster.ts`:

1. `getRoomSnapshot(redis, rk)` — pulls all posts, reactions, and member user IDs.
2. Build an **ephemeral** in-memory `authorHash ↔ userId` map. `authorHash(uid, rk) = sha256(uid || rk).slice(0, 8)`.
3. Rewrite every post and reaction to use the 8-char hash. Real user IDs never leave the server.
4. Send the anonymized payload to Claude (`claude-opus-4-6`) with a strict JSON-only system prompt. Exponential backoff on retries.
5. Parse the response (tolerant of accidental code fences), keep clusters of 2..5 authors.
6. Resolve hashes back to user IDs via the in-memory map and call `persistCluster` → insert into `match_candidates` with a 72h TTL.
7. The hash map is discarded when the function returns.

### Reveal flow

Matches are plain lists of user IDs. To see someone's name + contact:

1. `GET /api/matches` returns all non-expired matches containing the current user.
2. On `/matches/:matchId`, tapping a teammate avatar calls `POST /api/matches/:id/interest { targetUserId }`. The server inserts a `reveal_requests` row (uniquely keyed on `(match_id, from_user, to_user)`).
3. The client polls `GET /api/matches/:id/reveal/:otherUserId`:
   - `400 interest_not_declared` — you haven't declared yet.
   - `202 { status: 'pending' }` — you've declared, they haven't.
   - `200 { status: 'revealed', me, them }` — both sides declared. Returns both profiles (display name + contact handle).
4. `DELETE /api/matches/:id` dismisses the match (owner must be a member).

### HTTP API

All routes below `/api/matches` are gated by `requireAuth` middleware which validates the bearer token via `supabaseAdmin.auth.getUser`.

| Method | Path                                    | Purpose                                         |
| ------ | --------------------------------------- | ----------------------------------------------- |
| POST   | `/api/auth/signup`                      | Create user + profile, no email verification    |
| GET    | `/api/matches`                          | List non-expired matches for the current user   |
| POST   | `/api/matches/:id/interest`             | Declare interest in another member of a match   |
| DELETE | `/api/matches/:id`                      | Dismiss a match                                 |
| GET    | `/api/matches/:id/reveal/:otherUserId`  | Bilateral reveal status + profiles              |
| GET    | `/healthz`                              | Liveness check                                  |

## Local dev

```bash
# from repo root
npm install

# Redis — whichever you have
docker compose up -d            # requires Docker
# or
brew services start redis       # macOS Homebrew

# terminal A
npm run dev:server              # tsx watch src/index.ts on :4000

# terminal B
npm run dev:client              # vite on :5173
```

Open `http://localhost:5173` and sign up. You'll land directly in a room (no email verification).

### Manual smoke test

1. Sign up two accounts in different browser profiles (or one regular + one incognito).
2. In Chrome DevTools → **Sensors**, set both profiles to the same lat/lng. They should land in the same room.
3. Post notes / questions, try reactions and flag (3 flags hides).
4. To trigger matching without waiting for the 30 min idle TTL:

   ```bash
   redis-cli --scan --pattern 'room:*:alive' | xargs -n1 -I{} redis-cli del {}
   ```

   Within 30 s the lifecycle ticker fires `room:closing`, runs Claude clustering, then `room:dead` and redirects both clients to `/matches`.
5. Open a match, tap the other avatar, confirm interest. In the other profile, do the same. Within 10 s the reveal view shows both profiles.
6. Press **Done** to dismiss the match.

### Code fallback

Deny geolocation (or pick **Unsupported** in DevTools Sensors). You'll see the 6-digit code screen. Generate a code in one profile, type it in the other, and both join `sha256("code" || code)`.

## Useful commands

```bash
npm run dev:server                    # server with tsx watch
npm run dev:client                    # vite dev server
npm -w server run test                # server unit tests (vitest)
npm -w server run build               # tsc -> server/dist
```

## Privacy notes

- Only anonymous 8-char author hashes and public post text are sent to Claude — no user IDs, emails, display names, avatars, lat/lng, or IPs.
- The `hash → userId` map is built in memory per matching run and discarded when the run completes.
- `match_candidates` and `reveal_requests` have RLS enabled with no policies; only the server's service-role key reads or writes them.
- Passwords are handled exclusively by Supabase Auth — the server never stores, logs, or forwards them.
- Geolocation coordinates and client IPs are only used to derive the hashed room key and are never persisted.

## Repository layout

```
client/                  Vite + React app
  src/
    App.tsx              Routes + auth guards
    main.tsx             React entry
    lib/
      auth.tsx           AuthProvider (session + profile context)
      supabase.ts        Anon-key client
      socket.ts          socket.io-client wrapper
      api.ts             Fetch helpers for /api
      avatar.ts          Animal+color generator
    pages/               Login, Room, Matches, MatchDetail, RevealScreen
    components/          PostList, Composer, ReactionBar
server/
  src/
    index.ts             Boot + graceful shutdown
    server.ts            Express + Socket.io + lifecycle wiring
    env.ts               Zod-validated process.env
    supabaseAdmin.ts     Service-role Supabase client
    redis.ts             ioredis client
    avatar.ts            Server-side animal+color generator
    middleware/
      requireAuth.ts     Bearer-token check → req.userId
    routes/
      auth.ts            POST /signup
      matches.ts         List / interest / dismiss
      reveal.ts          Bilateral reveal
    room/
      key.ts             gridCell / roomKey / authorHash
      store.ts           Redis room state helpers
      lifecycle.ts       Interval-driven state transitions
    matching/
      prompt.ts          System prompt + payload builder + parser
      cluster.ts         Anonymize → Claude → resolve → persist
      persist.ts         Insert into match_candidates
  supabase/
    schema.sql           Tables + indexes + RLS
```

## Feature summary

- **One-shot signup** — Single form collects name, email, and password. The server provisions the Supabase auth user with `email_confirm: true` and creates the profile in the same request, so users land straight in a room. No verification emails.
- **Password sign-in** — Returning users toggle to "Sign in" and authenticate with `signInWithPassword` directly against Supabase.
- **Auto-generated identities** — Every new account is assigned a random animal + color (e.g. "teal fox") server-side, used as the public handle inside rooms until a match reveal.
- **Proximity rooms** — Same ~15 m grid cell + same public IP auto-joins the same ephemeral room, with no discovery UI. Room keys are `sha256(cell || ip)`, so the server never stores raw coordinates.
- **Code-based fallback rooms** — If geolocation is denied or unsupported, the client offers a 6-digit code form. Rooms keyed by `sha256("code" || code)` let people on different networks meet.
- **Live anonymous feed** — Questions (1..280 chars) and Notes broadcast to everyone in the room in real time via Socket.io. Posts are Zod-validated on the server.
- **Five-emoji reactions** — Each user can set exactly one of `😕 🔥 👍 🤔 🙌` per post; the server reconciles counts and broadcasts updates.
- **Community moderation** — Any member can flag a post; three distinct flaggers hide it from the public feed.
- **Automatic room lifecycle** — A 30 s interval ticker transitions rooms `live → matching → dead` based on idle TTL (30 min), hard TTL (3 h), and a 15-minute matching window.
- **Claude-powered matching** — When a room closes, the server anonymizes posts and reactions behind 8-char hashes and asks `claude-opus-4-6` to cluster 2..5 compatible authors by topic + co-reaction. The hash↔userId map never leaves memory.
- **Persistent match candidates** — Clusters are written to `match_candidates` with a 72 h TTL and surface on `/matches` for every member.
- **Bilateral reveal** — Two users must each tap "I'm interested" on the other before the server returns either's display name and contact handle. Unilateral interest yields `202 pending`.
- **Match dismissal** — A member can `DELETE` a match to clear it from their list (cascade-deletes any reveal requests).
- **RLS-protected data** — `profiles` is readable by any authenticated user but writable only to its owner; `match_candidates` and `reveal_requests` have RLS enabled with no policies, so only the server's service-role key can touch them.
- **Privacy by construction** — Claude only ever sees post text and 8-char author hashes; raw user IDs, emails, coordinates, and IPs never leave the server. Passwords live only in Supabase Auth.

## How it works (plain English)

You open Proximate and make an account with just a name, email, and password — no inbox confirmation, you're in.

Your phone's location (or a shared 6-digit code) drops you into an **anonymous room** with anyone else in the same spot: a café, a lecture hall, a waiting area. You show up as something like "teal fox" — no photo, no name.

Inside the room, anyone can post short **questions** or **notes**. Everyone sees them live. You can react with an emoji or flag things that don't belong.

After the room goes quiet for a while, it **closes**. The app sends the anonymous posts (just the 8-character nicknames, never your real identity) to Claude, which reads the conversation and groups together people who seemed to click — people who asked about the same topic, reacted to each other, or cared about the same thing.

Those groups show up in your **Matches** tab. You can tap a stranger's avatar to say "I'm interested." They get no notification. But if they tap yours back, the app **reveals** both of you to each other at the same time — real name, contact handle, done. If they never tap, neither of you ever finds out the other was interested.

That's it: be in the same place, talk anonymously, and only exchange identities when both people agree.
