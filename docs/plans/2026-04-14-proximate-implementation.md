# Proximate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Proximate — a proximity-based anonymous connection PWA where users auto-join ephemeral rooms with nearby people, share anonymous posts, and receive AI-clustered study-match suggestions with a bilateral reveal flow.

**Architecture:** Monorepo with a `server/` (Node + Express + Socket.io + Redis + Supabase Admin + Claude SDK) and a `client/` (React PWA via Vite + Tailwind + Socket.io client + Supabase JS). Rooms are keyed by `sha256(grid_cell || public_ip)` in Redis with TTL-driven lifecycle. Matching runs as a one-shot Claude call per room at session end; results land in Supabase.

**Tech Stack:** Node 20, Express, Socket.io 4, ioredis, @supabase/supabase-js, @anthropic-ai/sdk, Vite, React 18, TypeScript, Tailwind, Vitest, Jest.

**Reference design:** `docs/plans/2026-04-14-proximate-design.md`

---

## Task 0: Repo scaffolding

**Files:**
- Create: `package.json` (workspace root)
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`
- Create: `client/package.json`, `client/vite.config.ts`, `client/tsconfig.json`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`
- Create: `docker-compose.yml` (Redis only)
- Create: `.env.example`
- Create: `.gitignore`

**Steps:**
1. Init npm workspaces in root `package.json` with `workspaces: ["server", "client"]`
2. Scaffold `server`: `tsx` for dev, `typescript`, `express`, `socket.io`, `ioredis`, `@supabase/supabase-js`, `@anthropic-ai/sdk`, `zod`, `vitest`
3. Scaffold `client` with Vite React-TS template, add `socket.io-client`, `@supabase/supabase-js`, `tailwindcss`, `react-router-dom`
4. `docker-compose.yml` runs `redis:7-alpine` on `localhost:6379`
5. `.env.example` documents: `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SERVER_URL`
6. Verify: `npm install` at root succeeds; `docker compose up -d redis` starts Redis
7. Commit: `chore: scaffold server/client workspaces and docker compose`

---

## Task 1: Grid cell + room key (pure, TDD)

**Files:**
- Create: `server/src/room/key.ts`
- Test: `server/src/room/key.test.ts`

**Step 1 — failing test:**
```ts
import { describe, it, expect } from 'vitest'
import { gridCell, roomKey } from './key'

describe('gridCell', () => {
  it('snaps lat/lng into a stable ~15m bucket', () => {
    const a = gridCell(43.07295, -89.40124)
    const b = gridCell(43.07296, -89.40123) // ~1m away
    expect(a).toBe(b)
  })
  it('yields different buckets for points ~100m apart', () => {
    const a = gridCell(43.07295, -89.40124)
    const b = gridCell(43.07395, -89.40124)
    expect(a).not.toBe(b)
  })
})

describe('roomKey', () => {
  it('is deterministic for same cell+ip', () => {
    const k1 = roomKey('cell_x', '1.2.3.4')
    const k2 = roomKey('cell_x', '1.2.3.4')
    expect(k1).toBe(k2)
    expect(k1).toHaveLength(64)
  })
  it('differs when IP differs', () => {
    expect(roomKey('cell_x', '1.2.3.4')).not.toBe(roomKey('cell_x', '5.6.7.8'))
  })
})
```

**Step 2:** `npx vitest run server/src/room/key.test.ts` → FAIL.

**Step 3 — implementation:**
```ts
import { createHash } from 'node:crypto'

const CELL_SIZE_DEG = 0.00015 // ~16.7m latitude; fine for MVP

export function gridCell(lat: number, lng: number): string {
  const latBucket = Math.round(lat / CELL_SIZE_DEG)
  const lngBucket = Math.round(lng / CELL_SIZE_DEG)
  return `${latBucket}:${lngBucket}`
}

export function roomKey(cell: string, ip: string): string {
  return createHash('sha256').update(`${cell}||${ip}`).digest('hex')
}

export function authorHash(userId: string, roomKeyHex: string): string {
  return createHash('sha256').update(`${userId}||${roomKeyHex}`).digest('hex').slice(0, 8)
}
```

**Step 4:** Re-run tests → PASS.

**Step 5:** Commit: `feat(server): grid cell + room key hashing`

---

## Task 2: Redis room store

**Files:**
- Create: `server/src/room/store.ts`
- Test: `server/src/room/store.test.ts` (uses real Redis via `docker compose up redis`)

**What it exposes:**
```ts
createOrTouchRoom(roomKey): Promise<RoomMeta>
addMember(roomKey, userId): Promise<void>
removeMember(roomKey, userId): Promise<void>
addPost(roomKey, post): Promise<void>        // post = { id, authorUserId, type, text, createdAt }
addReaction(roomKey, postId, userId, emoji): Promise<void>
flagPost(roomKey, postId, userId): Promise<number>  // returns new flag count
getPublicFeed(roomKey): Promise<PublicPost[]>  // excludes hidden (flagCount >= 3)
getRoomSnapshot(roomKey): Promise<{ posts, reactions, memberUserIds }>  // for matching
wipeRoom(roomKey): Promise<void>
getRoomState(roomKey): Promise<'live' | 'matching' | 'dead' | null>
setRoomState(roomKey, state): Promise<void>
```

Constants: `IDLE_TTL_SECONDS = 1800`, `HARD_TTL_SECONDS = 10800`, `MATCHING_WINDOW_SECONDS = 900`.

**Behavior:**
- `createOrTouchRoom` sets `meta` HASH if absent (`{createdAt, hardExpiresAt, state: 'live'}`), then resets idle TTL on all `room:{key}:*` keys via `EXPIRE`.
- Reject writes when `state !== 'live'` or `now > hardExpiresAt`.
- Use a Redis key `room:{key}:post:{id}:flaggers` SET for per-user flag dedupe.
- `wipeRoom` uses `SCAN MATCH room:{key}:*` + `UNLINK`.

**Steps:**
1. Write tests (create room, add posts, add reactions, flag-to-hide, wipe) against a Redis running via docker-compose
2. Implement incrementally; each test red → green
3. Commit: `feat(server): redis-backed room store with TTLs`

---

## Task 3: Express + Socket.io server with room join

**Files:**
- Create: `server/src/server.ts`
- Modify: `server/src/index.ts` to start server
- Create: `server/src/middleware/auth.ts` (verifies Supabase JWT from socket handshake)

**Behavior:**
- HTTP server on `PORT` (default 4000); CORS allow `VITE_SERVER_URL` origin
- Socket.io with `handshake.auth = { token, lat, lng }`
- Middleware: validate JWT via `supabase.auth.getUser(token)`; reject on failure
- Compute `ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0] ?? socket.handshake.address`
- Compute `cell = gridCell(lat, lng)`, `key = roomKey(cell, ip)`
- `createOrTouchRoom(key)`, `addMember(key, user.id)`, `socket.join(key)`
- Emit `room:state` with the current public feed
- On `disconnect`: `removeMember`

**Tests:** integration test using `socket.io-client` + a running server instance with a stubbed Supabase auth.

Commit: `feat(server): socket.io room join with auth + proximity keying`

---

## Task 4: Post, reaction, flag events

**Files:**
- Modify: `server/src/server.ts`

**Handlers:**
- `post:new` `{ type, text }` → validate with zod (`type in {question, note}`, `text.length ≤ 280`), call `addPost`, broadcast `post:new` with public shape to the room
- `reaction:add` `{ postId, emoji }` → validate emoji in allowed set, call `addReaction`, broadcast `reaction:update`
- `post:flag` `{ postId }` → call `flagPost`; if new count ≥ 3, broadcast `post:hidden { postId }`

All handlers refuse when room state ≠ `live`.

**Tests:** integration tests for each event covering happy path + validation failure + flag-to-hide.

Commit: `feat(server): post/reaction/flag socket handlers`

---

## Task 5: Lifecycle + matching window transition

**Files:**
- Create: `server/src/room/lifecycle.ts`
- Modify: `server/src/server.ts` to start the lifecycle ticker

**Behavior:**
- Ticker every 30s: iterate `SCAN room:*:meta`, for each room:
  - If `now > hardExpiresAt` or idle TTL has expired (detect via `meta` presence + a sentinel `room:{key}:alive` key with idle TTL): transition `live → matching`
  - When entering matching: set `state = 'matching'`, broadcast `room:closing` to the socket room, schedule `runMatching(key)` (Task 6)
  - After matching window (15 min) or matching completion: `wipeRoom(key)` and broadcast `room:dead`
- Use a single Redis key `room:{key}:alive` with `EXPIRE IDLE_TTL_SECONDS` as the idle indicator; refresh in `createOrTouchRoom`.

**Tests:** unit test the transition function with a fake clock + fake Redis store interface.

Commit: `feat(server): room lifecycle ticker and matching window transition`

---

## Task 6: Claude clustering job

**Files:**
- Create: `server/src/matching/cluster.ts`
- Create: `server/src/matching/prompt.ts`
- Test: `server/src/matching/cluster.test.ts` (stubs the Anthropic client)

**Behavior:**
1. Call `getRoomSnapshot(roomKey)` → posts + reactions + memberUserIds
2. Build an in-memory `hash → userId` map via `authorHash(userId, roomKey)`
3. Compose payload: `{ posts: [{post_id, author: hash, type, text}], reactions: [{post_id, author: hash, emoji}] }`
4. Send to `claude-opus-4-6` with a system prompt instructing it to return **only** JSON of the form `[{cluster_id, author_hashes, shared_theme}]`, min 2 authors, max 5 authors, and to favor clusters that share both themes and co-reactions
5. Parse; for each cluster, map hashes → userIds (drop unknown), skip clusters with <2 resolved users
6. For each valid cluster, insert into Supabase `match_candidates` (Task 7 schema)
7. Discard the hash map
8. Retry the Claude call up to 2x with exponential backoff; on final failure, log and return empty

**Tests:** unit test with a stubbed Anthropic client returning a fixture; verify hash→id mapping and that no userIds appear in the prompt text.

Commit: `feat(server): claude clustering job with opaque author hashes`

---

## Task 7: Supabase schema + match/reveal endpoints

**Files:**
- Create: `server/supabase/schema.sql`
- Create: `server/src/routes/matches.ts`
- Create: `server/src/routes/reveal.ts`
- Modify: `server/src/server.ts` to mount routes

**Schema:**
```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_animal text not null,
  avatar_color text not null,
  contact_handle text
);

create table match_candidates (
  id uuid primary key default gen_random_uuid(),
  user_ids uuid[] not null,
  shared_theme text not null,
  room_context text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table reveal_requests (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references match_candidates(id) on delete cascade,
  from_user uuid not null,
  to_user uuid not null,
  created_at timestamptz not null default now(),
  unique (match_id, from_user, to_user)
);
```

**Endpoints (all JWT-authenticated):**
- `GET /api/matches` → list `match_candidates` where `auth.uid() = ANY(user_ids)` and not expired
- `POST /api/matches/:id/interest` `{ targetUserId }` → insert into `reveal_requests`
- `GET /api/matches/:id/reveal/:otherUserId` → if both directions of interest exist, return both users' `display_name + contact_handle`; otherwise 202 "pending"

**Tests:** integration tests against a Supabase test project OR a mocked Supabase client.

Commit: `feat(server): supabase schema and match/reveal endpoints`

---

## Task 8: Client scaffolding + Supabase auth

**Files:**
- Create: `client/src/lib/supabase.ts`
- Create: `client/src/pages/Login.tsx`
- Create: `client/src/pages/OnboardProfile.tsx` (pick display_name + contact_handle; random animal/color assigned server-side or on first insert)
- Modify: `client/src/App.tsx` (router + auth gate)

**Behavior:**
- Magic-link login; after login, if `profiles` row missing, redirect to onboarding
- On submit, insert `profiles` row with random animal/color from a fixed list
- Persist session via Supabase default storage

Commit: `feat(client): supabase auth and profile onboarding`

---

## Task 9: Room screen (geolocation + socket + feed)

**Files:**
- Create: `client/src/pages/Room.tsx`
- Create: `client/src/lib/socket.ts`
- Create: `client/src/components/PostList.tsx`, `Composer.tsx`, `ReactionBar.tsx`

**Behavior:**
- On mount: request `navigator.geolocation.getCurrentPosition`
- On success: open socket with `auth = { token, lat, lng }`
- On denied: show blocking screen with a manual 6-digit code input (Task 11)
- Render feed from `room:state` and live `post:new` / `reaction:update` / `post:hidden`
- Composer with Question/Note toggle, 280-char cap
- Reaction bar on each post (5 emoji set)
- Flag button (long-press or kebab menu)
- On `room:closing`: show "Session ended, matching…" overlay; on `room:dead`: redirect to match list

Commit: `feat(client): room screen with live feed, composer, reactions, flag`

---

## Task 10: Matches + reveal flow UI

**Files:**
- Create: `client/src/pages/Matches.tsx`
- Create: `client/src/pages/MatchDetail.tsx`
- Create: `client/src/pages/RevealScreen.tsx`

**Behavior:**
- `Matches`: list from `GET /api/matches`, show `shared_theme` + avatars
- `MatchDetail`: list of other matched avatars with "I'm interested" button per avatar → `POST /api/matches/:id/interest`
- After posting interest, poll `GET /api/matches/:id/reveal/:otherUserId` every 10s while the screen is open; on 200, transition to `RevealScreen` showing both `display_name + contact_handle` and a one-shot "Say hi" screen
- After close, hit a `DELETE /api/matches/:id` (add to Task 7) to clear it

Commit: `feat(client): matches list and bilateral reveal flow`

---

## Task 11: Manual room-code fallback

**Files:**
- Modify: `server/src/server.ts` (accept `{ token, code }` alt auth)
- Modify: `client/src/pages/Room.tsx`

**Behavior:**
- If geolocation denied, user enters a 6-digit code; server uses `roomKey('code', code)` as the room key (IP not mixed in for this path)
- One user "creates" the code by typing a fresh one; others join by typing the same

Commit: `feat: manual room code fallback for denied geolocation`

---

## Task 12: README + final smoke test

**Files:**
- Create: `README.md` (setup: env vars, `docker compose up redis`, `npm run dev`, Supabase schema apply)
- Manual smoke: two browser profiles with mocked geolocation (Chrome devtools → Sensors) to the same lat/lng; post from each; let the room time out (or fire a dev-only `POST /dev/force-matching/:key`); verify match appears in Supabase and reveal works end-to-end.

Commit: `docs: add README and dev smoke test instructions`

---

## Notes for the Implementer

- **DRY, YAGNI, TDD.** Pure-function tasks (keying, cluster parsing, lifecycle transitions) are test-first. Socket and HTTP handlers get integration tests. UI is exercised manually.
- **Do not** send any user IDs, emails, names, lat/lng, or IPs to the Claude API. Only opaque 8-char hashes + public post text.
- **Do not** keep the `hash → userId` map past the end of `runMatching(key)`.
- **Commit after each task.** If a task gets large, split and commit more often.
- **Environment:** requires `ANTHROPIC_API_KEY` (user will provide), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, and matching `VITE_*` vars for the client.
