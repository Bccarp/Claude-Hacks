# Proximate — Design

A proximity-based anonymous connection PWA. Users auto-join an ephemeral "room" with others nearby, share anonymous questions/notes/reactions, and after the session an AI surfaces study-partner matches with a bilateral opt-in reveal.

## Goals

- Automatic proximity grouping, nothing to scan or tap
- Full anonymity inside rooms; posts vanish with the room
- Post-session AI clustering to suggest matches
- Bilateral, explicit de-anonymization only
- No PII ever sent to the AI layer

## Stack

- **Frontend:** React PWA (Vite + Tailwind), Socket.io client, Supabase JS client
- **Backend:** Node.js, Express, Socket.io
- **Ephemeral state:** Redis (room data with TTLs)
- **Persistent state:** Supabase (auth + user profiles + pending matches + reveal requests)
- **AI:** Claude API (`claude-opus-4-6`), one call per room at session end

## Proximity & Room Identity

A room is keyed by `sha256(grid_cell || public_ip)`:
- `grid_cell`: user lat/lng snapped to a ~15m square (H3 res 11 or lat/lng quantization)
- `public_ip`: server reads from the socket handshake (`x-forwarded-for`)

On open:
1. Client requests geolocation permission
2. Client opens socket with lat/lng in handshake auth
3. Server computes `room_key` and joins the socket
4. If new, room is created in Redis with `idle_ttl=1800s` and `hard_expires_at=now+3h`

**Fallback:** if geolocation is denied, a 6-digit manual room code screen unblocks demos indoors. This is an escape hatch, not the primary flow.

## Room Lifecycle

- Every join/post/reaction refreshes the idle TTL
- Hard 3h cap enforced on each write
- When TTL fires, room transitions `live → matching` for a 15-minute window during which no new posts are accepted and clustering runs
- After the matching window completes: all room data is wiped from Redis; only the resulting match candidates persist in Supabase

## Real-Time Feed

**Post types:**
- **Question** — ≤280 chars, ❓
- **Note** — ≤280 chars, 💡
- **Reaction** — emoji pulse (😕 🔥 👍 🤔 🙌) attached to an existing post

### Redis schema

```
room:{key}:meta         HASH  {created_at, hard_expires_at, state}
room:{key}:posts        LIST  (post_ids, newest first)
room:{key}:post:{id}    HASH  {author_user_id, type, text, created_at, flags}
room:{key}:reactions    HASH  {post_id → {user_id → emoji}}
room:{key}:members      SET   (user_ids currently connected)
```

All keys share one TTL refresh cycle. A single `SCAN + DEL` wipes the room.

### Public post shape (sent to clients)

```json
{
  "post_id": "...",
  "type": "question|note",
  "text": "...",
  "avatar": "Purple Fox",
  "reactions": {"😕": 4, "🔥": 2},
  "flag_count": 0,
  "created_at": "..."
}
```

Never any `user_id`. "Mine" is marked client-side only.

### Moderation

- Each user can flag a post once (tracked in a Redis set)
- At `flag_count >= 3`, server stops broadcasting the post and tells clients to hide it
- Data stays in Redis (still used for matching) but invisible in the feed

### Socket events

`room:join`, `room:state`, `post:new`, `post:flag`, `post:hidden`, `reaction:add`, `room:closing`, `room:dead`.

## Auth & Profiles (Supabase)

- Email magic-link login required on first open
- Profile: `id`, `display_name`, `avatar_animal`, `avatar_color`, optional `contact_handle` (shown only after bilateral reveal)
- Inside rooms, only `<color> <animal>` is displayed ("Purple Fox"); the real `user_id` never leaves the server

## Post-Session Matching

**Trigger:** room state transitions `live → matching`. Server kicks off one background job per room.

### Input prep (privacy-critical)

Server builds a JSON payload for Claude:

```json
{
  "posts": [
    {"post_id": "p1", "author": "u_7a3f", "type": "question", "text": "..."}
  ],
  "reactions": [
    {"post_id": "p1", "author": "u_9d2e", "emoji": "😕"}
  ]
}
```

- `author` is an **opaque per-room hash**: `sha256(user_id || room_key)` truncated to 8 chars. Prevents cross-room linkage by the model.
- Only question/note text, type, and these hashes go to Claude. No name, email, profile, lat/lng, or IP.

### Claude call

Single request to `claude-opus-4-6`. Prompt asks Claude to:
1. Group authors who expressed similar confusion, using both shared themes in questions and co-reactions on the same posts
2. Return JSON clusters: `[{cluster_id, author_hashes, shared_theme}]`
3. Minimum cluster size 2, max 5 authors per cluster

### Post-processing

- Server maps opaque hashes → real `user_id`s using an in-memory lookup built just before the call, then discarded
- For each cluster, inserts a `match_candidate` row in Supabase: `{match_id, user_ids[], shared_theme, room_context, expires_at: now+48h}`
- Matched users see the suggestion on their next app open
- Redis room wipe runs immediately after

### Failure handling

- Claude call retries 2x with backoff
- On final failure: wipe the room and create no matches (users see nothing rather than bad matches)

## Reveal Flow

1. User taps match notification → sees `shared_theme` and the anonymous avatars of matched users
2. User taps "I'm interested" on specific avatars → creates a `reveal_request` row
3. Other side sees "Someone from your match wants to connect" on next open
4. **Only when both sides mark interest in each other** does the server reveal `display_name` + `contact_handle` to both
5. One-shot intro screen, then the `match_candidate` is deleted
6. Unilateral interest expires with the match at 48h. No rejection signals — silence only.

## Error Handling

- **Geolocation denied:** blocking screen explaining why location is needed; manual room-code escape hatch
- **Claude failure:** retry 2x, then wipe and no-match
- **Socket disconnect:** auto-reconnect; <30s gap treated as same session
- **Redis down:** show "rooms unavailable, try again" — no degraded mode

## Testing

- **Unit:** room-key hashing, grid cell math, flag threshold, reveal state machine, opaque-hash generation
- **Integration:** Socket.io join/leave, Redis TTL expiry triggering match flow, Supabase reveal handshake
- **Manual/demo:** two browsers with mocked geolocation to the same cell, third in a different cell
- **AI:** stub Claude with fixture clusters in tests; one live smoke test with a small fixture room

## Out of Scope

- Real Bluetooth detection
- Native mobile app
- Persistent post history
- Cross-room user linking
- Moderation tools beyond flag-hide
- AI concierge / live confusion summaries / question rewriting
