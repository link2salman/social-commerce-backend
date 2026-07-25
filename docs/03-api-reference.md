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
| GET | `/feed/for-you` | protect | `?cursor=&limit=` | **personalized, ranked** (engagement · recency · author affinity — see `rankingService`); excludes own/blocked authors |
| GET | `/feed/following` | protect | `?cursor=&limit=` | reverse-chronological; only accounts the viewer follows |

Both return `{items, nextCursor}` — page size 10 (max 50), `nextCursor: null` on
the last page. The cursor is opaque: `/following` keysets on `(created_at,
video_id)`; `/for-you` carries a rank anchor + score so paging stays stable as
time passes. Ranker weights are env-tunable (`RANK_*`).

## Search

| Method | Path | Auth | Query | Notes |
|---|---|---|---|---|
| GET | `/search` | protect | `?type=products\|videos\|users&q=` | one discovery surface; each type returns `{items}` in the same shape its list uses. Products match title/description, videos match caption (`#hashtag`-aware), users match username/display name. pg_trgm-backed. Empty `q` → `{items: []}`; unknown `type` → 400 |

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
| POST | `/videos/:id/share` | protect | records a share, increments `share_count` → `{shareCount}` (declared before `/:id/:action` so "share" isn't read as an engagement) |
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
| POST | `/sellers` | protect | `{name}` → register as a seller (one per user; 409 if already one) |
| GET | `/sellers/me` | protect | the caller's seller profile (404 if none) |
| GET | `/sellers/me/products` | protect | the caller's own catalog `{items}` |
| GET | `/sellers/me/orders` | protect | paid orders containing the caller's products → `{items}` (buyer, the seller's line items, address, fulfillment) |
| POST | `/sellers/me/orders/:id/fulfill` | protect (seller in order) | `{trackingNumber?, carrier?}` → marks the order shipped |
| POST | `/sellers/me/orders/:id/deliver` | protect (seller in order) | marks a shipped order delivered |
| POST | `/products` | protect (seller) | `{title, description?, price, currency?, stock, images?[url], variants?[{name, priceDelta}]}` → Product (201). Money in **dollars**. 403 if not a seller |
| PATCH | `/products/:id` | protect (owner) | partial update; `images`/`variants` REPLACE the set when present |
| DELETE | `/products/:id` | protect (owner) | soft-delete → `{ok:true}` |
| POST | `/cart/summary` | protect | `{items: [{productId, variantId, quantity (1–99)}]}` → server-priced `CartSummary` |
| POST | `/orders/intent` | protect | `{items (min 1), shippingAddress?}` → `{order, clientSecret, publishableKey}` — prices server-side, enforces stock (409 if insufficient), stores the address, creates a pending order + Stripe PaymentIntent. Idempotent: a repeat of the same cart reuses the open order |
| POST | `/orders/:id/confirm` | protect | verifies the PaymentIntent directly with Stripe, marks the order paid |
| GET | `/orders` | protect | history, newest first |
| GET | `/orders/:id` | protect | line items + totals breakdown, plus `shippingAddress` and `fulfillment {status, trackingNumber, carrier, shippedAt, deliveredAt}` |

See [04-flows.md](04-flows.md) "Checkout" for why this is two calls, not one.
With no `STRIPE_SECRET_KEY` set, `/orders/intent` returns a clean 503 for any
non-zero total **and leaves no order behind** (the pending order + reserved
stock are rolled back); `$0` orders still complete end-to-end through a
`provider: 'none'` branch.

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

Rows are created by real triggers (no write endpoint): `follow`, `friend_request`,
`friend_accept`, `comment`, `comment_reply`, and `like` (a like on your video —
feed row only, no push, deduped on the first like). Never self-notifies.

## Admin / moderation

Not called by the mobile app — drive with curl or a REST client until an
admin UI exists.

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/admin/reports` | admin | `?status=&targetType=&cursor=`, the moderation queue |
| GET | `/admin/reports/:id` | admin | report + hydrated target (target resolved with `paranoid: false`, `null` if long gone) |
| POST | `/admin/reports/resolve` | admin | `{targetType, targetId, action: dismiss\|remove_content\|suspend_user, note? (≤500)}` — resolves **every pending report against that target** in one transaction |
| POST | `/admin/orders/:id/refund` | admin | refunds a settled order via Stripe and marks it refunded → Order. Idempotent; only a `succeeded` order can be refunded (else 409) |

`remove_content` soft-deletes a video / hard-deletes a comment;
`suspend_user` sets `is_active = false`, which `protect` turns into a 403 on
that user's next request.

## Uploads & devices

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| POST | `/uploads/sign` | protect | `{kind: video\|image\|avatar\|chat, contentType}` → a presigned S3 PUT URL. The API never proxies bytes — the client PUTs direct, sending the same `Content-Type` it signed for |
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
