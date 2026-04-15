# Proximate

A proximity-based anonymous connection PWA. Nearby people auto-join the same ephemeral room, share anonymous questions and notes, and after the room closes Claude clusters compatible strangers into match candidates. A bilateral reveal flow exchanges contact info only when both sides opt in.

## Stack

- **Server** — Node 20, Express, Socket.io, ioredis, `@supabase/supabase-js`, `@anthropic-ai/sdk`, Zod, Vitest
- **Client** — Vite, React 18, TypeScript, Tailwind, `socket.io-client`, `@supabase/supabase-js`, `react-router-dom`
- **Infra** — Redis (rooms), Supabase (auth, profiles, matches), Claude (`claude-opus-4-6`) for clustering

## Prerequisites

- Node 20+
- Docker (for Redis)
- A Supabase project
- An Anthropic API key

## Environment

Copy `.env.example` to `.env` at the repo root and fill in:

```
PORT=4000
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ANTHROPIC_API_KEY=<anthropic key>
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_SERVER_URL=http://localhost:4000
```

The server reads the root `.env` via `dotenv`. The client reads `VITE_*` vars from the same file through Vite. Keep the service-role key server-side only — it bypasses Supabase RLS.

## Supabase setup

1. Create a new Supabase project.
2. Enable email (magic link) auth in **Authentication → Providers**.
3. Open the SQL editor and run `server/supabase/schema.sql`. This creates `profiles`, `match_candidates`, `reveal_requests`, the indexes, and the RLS policies.
4. Copy `SUPABASE_URL`, the `service_role` key, and the `anon` key into your `.env`.

## Local dev

```bash
# from repo root
npm install
docker compose up -d redis

# terminal A
npm run dev:server

# terminal B
npm run dev:client
```

The client is served at `http://localhost:5173` and talks to the server at `http://localhost:4000`.

## How it works

- **Rooms.** On connect, the server computes `sha256(gridCell(lat,lng) || publicIP)` as the room key. Same ~15 m bucket + same public IP → same room. State lives in Redis with idle and hard TTLs.
- **Posts.** `post:new` (Question/Note, ≤ 280 chars), `reaction:add` (5-emoji set), `post:flag` (3 flags hides). All events broadcast to the room.
- **Lifecycle.** A ticker moves expired rooms `live → matching → dead`. Entering `matching` broadcasts `room:closing`; entering `dead` wipes the room and broadcasts `room:dead`.
- **Matching.** On `matching`, the server snapshots posts/reactions, rewrites authors as opaque 8-char hashes (`sha256(userId || roomKey).slice(0,8)`), and asks Claude for clusters of 2–5 authors. Real user IDs never leave the server. Clusters are written to `match_candidates` with a 72h TTL.
- **Reveal.** A match is a list of user IDs. Each user opens the match, taps avatars they're interested in, and polls for reveal. Only when both directions declare interest does the server return both users' `display_name + contact_handle`.
- **Fallback.** If geolocation is denied or unavailable, the user joins by 6-digit code. The room key becomes `sha256("code" || code)` (no IP). Any user can generate a fresh code and share it.

## Manual smoke test

1. Apply the schema and start Redis + server + client.
2. Open two browser profiles (or one regular + one incognito).
3. In both, sign in via magic link, complete onboarding (display name + contact).
4. Chrome DevTools → **Sensors** (or **More tools → Sensors**) → set both profiles to the same lat/lng (e.g. `43.07295, -89.40124`).
5. Navigate to `/`. Both should land in the same room. Post a few Questions/Notes in each; they should appear live for the other. Try reactions and the flag menu (3 flags hides).
6. To trigger matching without waiting for the 30 min idle TTL, run in `redis-cli`:

   ```
   redis-cli --scan --pattern 'room:*:alive' | xargs -n1 -I{} redis-cli del {}
   ```

   Within one tick (≤ 30 s) the server should emit `room:closing`, run Claude clustering, then `room:dead` and redirect both clients to `/matches`.
7. Each match appears in `/matches`. Open a match, tap the other avatar → "I'm interested". In the other profile, do the same. Within 10 s the screen transitions to the reveal view showing both names and contacts.
8. Press **Done** on the reveal → the match is dismissed and removed from the list.

### Testing the code fallback

On a profile where you deny geolocation (or pick **Unsupported** in DevTools → Sensors), you'll see the code screen. Use **Generate a new code** in one profile, type the same code in the other, and both join `sha256("code" || code)`. The active code is shown in the room header so the creator can share it.

## Useful commands

```bash
npm run dev:server          # server with tsx watch
npm run dev:client          # vite dev server
npm -w server run test      # server unit tests (vitest)
npm -w server run build     # tsc -> server/dist
```

## Privacy notes

- Only anonymous 8-char author hashes and public post text are sent to Claude — no user IDs, emails, display names, avatars, lat/lng, or IPs.
- The `hash → userId` map is constructed in-memory per matching run and discarded when the run completes.
- `match_candidates` and `reveal_requests` are RLS-protected with no policies; only the server's service-role key reads or writes them. Clients go through the server's `/api/matches` and reveal endpoints.
