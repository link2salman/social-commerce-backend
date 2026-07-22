# API reference

Base URL: `{API_URL}` — all routes below are relative to the `/v1` prefix
(`API_PREFIX` env var). `protect` = requires a valid access-token JWT
(`Authorization: Bearer <token>`, or an `access_token` cookie as a fallback).
`admin` = `protect` + `requireAdmin` (`users.is_admin = true`, 403 otherwise).

Success responses are **raw** — never wrapped in `{success, data}`. The app
parses the whole body against a Zod schema, so a success response *is* the
schema. Errors return an appropriate HTTP status with `{message}`; the app
never parses an error body, only the status code. See
[../ARCHITECTURE.md](../ARCHITECTURE.md) "The client is the spec" for why.

Two global limiters apply on top of the per-route auth: `authLimiter` (40
req/15min) on every `/auth/*` route, `apiLimiter` (300 req/60s) on everything
under `/v1`. Both share state across replicas via Redis when `REDIS_URL` is
set, otherwise per-instance in memory.

## Auth

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/auth/signup` | — | `{email, password (min 8), username}` | rate-limited |
| POST | `/auth/login` | — | `{email, password}` | rate-limited |
| POST | `/auth/refresh` | — | `{refreshToken}` | not rate-limited (would break the app's own refresh-storm dedup under load) |
| POST | `/auth/forgot-password` | — | `{email}` | **always 200**, even for an unknown email — never reveals account existence |
| POST | `/auth/reset-password` | — | `{email, code (6 digits), password}` | code is single-use |
| POST | `/auth/logout` | protect | — | blacklists the presented access token + revokes the refresh session |

`login`/`signup`/`refresh` all return the same shape:
`{accessToken, refreshToken, userId}`.

## Feed

| Method | Path | Auth | Query | Notes |
|---|---|---|---|---|
| GET | `/feed/for-you` | protect | `?cursor=` | algorithmic-slot-free — currently newest-first with product pills |
| GET | `/feed/following` | protect | `?cursor=` | only accounts the viewer follows |

Both return `{items, nextCursor}` — page size 10, keyset on `(created_at,
video_id)`, `nextCursor: null` on the last page.

## Users / social graph

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/users/search` | protect | `?q=`, people search |
| PATCH | `/users/me` | protect | `{displayName?, bio?, avatarUrl?}`, ≥1 field required |
| GET | `/users/:id` | protect | profile + viewer-relative relationship flags |
| GET | `/users/:id/videos` | protect | `?cursor=`, that user's video grid |
| GET | `/users/:id/followers` \| `/following` \| `/friends` | protect | `?cursor=`, page size 6 |
| GET | `/friend-requests` | protect | incoming requests, non-paginated |
| POST / DELETE | `/users/:id/follow` | protect | |
| POST | `/users/:id/friend-request` | protect | send |
| POST | `/users/:id/friend-request/accept` | protect | accept (route declared before the generic `/friend-request` match) |
| DELETE | `/users/:id/friend` | protect | remove an existing friendship |
| POST / DELETE | `/users/:id/block` | protect | severs the graph both directions |

## Videos, engagement, comments

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| POST | `/videos` | protect | `{videoUrl, thumbnailUrl?, caption, durationMs, soundName?, filterId?, productIds? (≤10)}` → 201. `filterId` is write-only (see [02-database-schema.md](02-database-schema.md)) |
| POST / DELETE | `/videos/:id/:action` | protect | `action ∈ {like, dislike, save, bookmark, favorite}` |
| GET | `/videos/:id/comments` | protect | top-level only (`parentId` null) |
| POST | `/videos/:id/comments` | protect | `{body (1–500), parentId?}` — setting `parentId` makes it a reply |
| GET | `/comments/:id/replies` | protect | one level deep |
| POST / DELETE | `/comments/:id/like` | protect | |

## Reports

| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/reports` | protect | `{targetType, targetId, reason (1–120)}` |

## Commerce

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/products` | protect | shop grid |
| GET | `/products/:id` | protect | |
| POST | `/cart/summary` | protect | `{items: [{productId, variantId, quantity}]}` → server-priced `CartSummary` |
| POST | `/orders/intent` | protect | `{items (min 1)}` → `{order, clientSecret, publishableKey}` — prices server-side, creates a pending order + Stripe PaymentIntent |
| POST | `/orders/:id/confirm` | protect | verifies the PaymentIntent directly with Stripe, marks the order paid |
| GET | `/orders` | protect | history, newest first |
| GET | `/orders/:id` | protect | line items + totals breakdown |

See [04-flows.md](04-flows.md) "Checkout" for why this is two calls, not one.
With no `STRIPE_SECRET_KEY` set, `/orders/intent` returns a clean 503 for any
non-zero total; `$0` orders still complete end-to-end through a `provider:
'none'` branch.

## Messaging

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/conversations` | protect | each item carries `isGroup`/`title`/`participants`; `participant` set for 1:1, null for groups |
| POST | `/conversations/with/:id` | protect | open-or-create a 1:1 |
| POST | `/conversations/group` | protect | `{title, participantIds (≥2)}` → 201; the caller's own id is implicit |
| GET | `/conversations/:id/messages` | protect | `?cursor=` |
| POST | `/conversations/:id/messages` | protect | `{body? (≤2000), imageUrl?}` — one of the two required |
| POST | `/conversations/:id/members` | protect | `{userIds (≥1)}`, add members |
| PATCH | `/conversations/:id/members/:userId` | protect | `{role}`, promote/demote — UI-gated by caller's own role, enforced server-side too |
| DELETE | `/conversations/:id/members/:userId` | protect | remove; `:userId === "me"` = leave |

## Events

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/events` | protect | upcoming, soonest first |
| POST | `/events` | protect | `{title, description, startsAt (ISO), endsAt?, locationName, priceCents (≥0), latitude, longitude}` → 201; server assigns id/cover, geocodes venue |
| GET | `/events/:id` | protect | |
| POST / DELETE | `/events/:id/rsvp` | protect | free RSVP toggle |
| POST | `/events/:id/tickets/intent` | protect | no body → `{clientSecret, publishableKey}`; a free event skips Stripe entirely |
| POST | `/events/:id/tickets/confirm` | protect | same two-step shape as commerce checkout |

## Calls

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/calls/ice-servers` | protect | `{iceServers}` — STUN (Google public, default) + TURN if configured |
| GET | `/calls` | protect | call log, newest first |
| POST | `/calls` | protect | `{peer \| null, isGroup, participants, direction, isVideo, outcome, startedAt, durationSec}` — exactly one of `peer`/`participants` must be populated (validator `superRefine`, mirrors the DB CHECK) |

## Notifications

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/notifications` | protect | `?cursor=`, persisted feed |
| GET | `/notifications/unread-count` | protect | `{count}` — polled for the badge, hits a partial index |
| POST | `/notifications/read` | protect | `{ids? (≤200)}` — no `ids` = mark all read |

## Admin / moderation

Not called by the mobile app — drive with curl or a REST client until an
admin UI exists.

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/admin/reports` | admin | `?status=&targetType=&cursor=`, the moderation queue |
| GET | `/admin/reports/:id` | admin | report + hydrated target (target resolved with `paranoid: false`, `null` if long gone) |
| POST | `/admin/reports/resolve` | admin | `{targetType, targetId, action: dismiss\|remove_content\|suspend_user, note? (≤500)}` — resolves **every pending report against that target** in one transaction |

`remove_content` soft-deletes a video / hard-deletes a comment;
`suspend_user` sets `is_active = false`, which `protect` turns into a 403 on
that user's next request.

## Uploads & devices

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| POST | `/uploads/sign` | protect | `{kind: video\|image\|avatar\|chat, contentType}` → a signed Supabase Storage URL. The API never proxies bytes — the client PUTs direct |
| POST | `/devices` | protect | `{token, platform}` — FCM registration |
| DELETE | `/devices` | protect | `{token}` — unregister |

## Webhooks & probes

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/v1/webhooks/stripe` | Stripe signature | mounted in `app.ts` **before** `express.json()` — needs the raw body to verify the signature. Not under the versioned `apiRouter`'s middleware stack |
| GET | `/live` | — | liveness — never touches a dependency |
| GET | `/health` | — | readiness — checks DB + Redis, 503 on failure |

## Realtime (Socket.io, not HTTP)

One socket per session, JWT in the handshake (`auth.token`) — same
revocation/session checks as an HTTP request. Every socket joins room
`user:<id>`.

| Event | Direction | Notes |
|---|---|---|
| `message:new` | server → client | emitted to every member's user room when a message posts |
| `typing` | client ↔ server | relayed to the conversation's other members |
| `call:offer` | server → client | stamped with the caller's identity; drives the incoming-call UI |
| `call:answer` / `call:ice` / `call:ended` | client ↔ server | WebRTC signaling relay, forwarded to the target user's room |

HTTP polling on `/conversations/:id/messages` already makes chat fully
functional without the socket — it's the realtime enhancement, not a
dependency.
