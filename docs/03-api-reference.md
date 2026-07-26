# API reference

Base URL: `{API_URL}` — all routes below are relative to the `/v1` prefix
(`API_PREFIX` env var). `protect` = requires a valid access-token JWT
(`Authorization: Bearer <token>`, or an `access_token` cookie as a fallback).
`admin` = `protect` + `requireAdmin` (`users.is_admin = true`, 403 otherwise).

## The response envelope

Every response is wrapped, and every wire field is **snake_case** in both
directions (request bodies and query params included). Built in
`utils/responseHandler.ts` — never `res.json()` a payload directly:

| Shape | Helper | Body |
|---|---|---|
| One resource | `sendSuccess` | `{success, message, data}` |
| A plain collection | `sendList` | `{success, message, items, ...extra}` |
| A keyset page | `sendCursor` | `{success, message, items, next_cursor}` |
| An offset page | `sendPaginated` | `{success, message, items, pagination}` |
| Ack only | `sendSuccess` (no data) | `{success, message}` |

**A collection stays flat** — `items` sits beside the envelope keys, never
nested under `data`. That is what lets the app strip the envelope with one
rule and still receive `{items, next_cursor}` intact.

The endpoint tables below describe the **payload** — what lands in `data`, or
what sits beside `items`. Assume the envelope around all of it.

Errors are `{success: false, message, code}` plus `errors: [{field, message}]`
on a validation failure. **`code` is the contract; `message` is for humans** and
may be reworded without notice. Codes live in `constants/errorCodes.ts`, mirrored
in the app's `core/api/errorCodes.ts`; the app keys its user-facing copy off
`code`, never off `message`. A 429 or a 503 also carries `Retry-After`, which the
app surfaces as a countdown.

Three endpoints deliberately sit **outside** the envelope, each commented at the
call site: `GET /live` and `GET /health` (probes, consumed by infrastructure that
expects a bare body) and `POST /v1/webhooks/stripe` (`{received: true}`, a shape
Stripe defines). See [../ARCHITECTURE.md](../ARCHITECTURE.md) "The response
contract" — including why this reverses an earlier no-envelope decision.

## Rate limiting

Two global limiters apply on top of the per-route auth: `authLimiter` (40
req/15min) on every `/auth/*` route, `apiLimiter` (300 req/60s) on everything
under `/v1`. Both share state across replicas via Redis when `REDIS_URL` is
set, otherwise per-instance in memory.

## Auth

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/auth/signup` | — | `{email, password (min 8), username}` | rate-limited |
| POST | `/auth/login` | — | `{email, password}` | rate-limited |
| POST | `/auth/refresh` | — | `{refresh_token}` | not rate-limited (would break the app's own refresh-storm dedup under load) |
| POST | `/auth/forgot-password` | — | `{email}` | **always 200**, even for an unknown email — never reveals account existence |
| POST | `/auth/reset-password` | — | `{email, code (6 digits), password}` | code is single-use |
| POST | `/auth/logout` | protect | — | blacklists the presented access token + revokes the refresh session |

`login`/`signup`/`refresh` all return the same payload:
`{access_token, refresh_token, user_id}`.

A failed login returns `INVALID_CREDENTIALS`; an expired access token returns
`SESSION_EXPIRED` and a malformed or revoked one `SESSION_INVALID`. All three are
401s, which is why they need distinguishing codes: the status alone cannot tell
"your token aged out, refresh it" from "that password is wrong."

What actually keeps those apart on the client is the **transport split**, not the
code — `api`'s 401 hook refreshes on *any* 401, and auth endpoints deliberately
use `plainApi`, which has no hook, so a failed login can never trigger a refresh.
The codes drive user-facing copy (`ERROR_CODE_COPY`), not the refresh decision.

## Feed

| Method | Path | Auth | Query | Notes |
|---|---|---|---|---|
| GET | `/feed/for-you` | protect | `?cursor=&limit=` | **personalized, ranked** (engagement · recency · author affinity — see `rankingService`); excludes own/blocked authors |
| GET | `/feed/following` | protect | `?cursor=&limit=` | reverse-chronological; only accounts the viewer follows |

Both return `{items, next_cursor}` — page size 10 (max 50), `next_cursor: null` on
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
| PATCH | `/users/me` | protect | `{display_name?, bio?, avatar_url?}`, ≥1 field required. The service input type (`ProfilePatch`) must match this exactly — see CLAUDE.md on all-optional types dropping fields silently |
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
| POST | `/videos` | protect | `{video_url, thumbnail_url?, caption, duration_ms, sound_name?, filter_id?, product_ids? (≤10)}` → 201. `filter_id` is write-only (see [02-database-schema.md](02-database-schema.md)) |
| POST | `/videos/:id/share` | protect | records a share, increments `share_count` → `{share_count}` (declared before `/:id/:action` so "share" isn't read as an engagement) |
| POST / DELETE | `/videos/:id/:action` | protect | `action ∈ {like, dislike, save, bookmark, favorite}` |
| GET | `/videos/:id/comments` | protect | top-level only (`parent_id` null) |
| POST | `/videos/:id/comments` | protect | `{body (1–500), parent_id?}` — setting `parent_id` makes it a reply |
| GET | `/comments/:id/replies` | protect | one level deep |
| POST / DELETE | `/comments/:id/like` | protect | |

## Reports

| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/reports` | protect | `{target_type, target_id, reason (1–120)}` |

## Commerce

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/products` | protect | shop grid |
| GET | `/products/:id` | protect | |
| POST | `/sellers` | protect | `{name}` → register as a seller (one per user; 409 if already one) |
| GET | `/sellers/me` | protect | the caller's seller profile (404 if none) |
| GET | `/sellers/me/products` | protect | the caller's own catalog `{items}` |
| GET | `/sellers/me/orders` | protect | paid orders containing the caller's products → `{items}` (buyer, the seller's line items, address, fulfillment) |
| POST | `/sellers/me/orders/:id/fulfill` | protect (seller in order) | `{tracking_number?, carrier?}` → marks the order shipped |
| POST | `/sellers/me/orders/:id/deliver` | protect (seller in order) | marks a shipped order delivered |
| POST | `/products` | protect (seller) | `{title, description?, price, currency?, stock, images?[url], variants?[{name, price_delta}]}` → Product (201). Money in **dollars**. 403 if not a seller (`NOT_A_SELLER`) |
| PATCH | `/products/:id` | protect (owner) | partial update; `images`/`variants` REPLACE the set when present |
| DELETE | `/products/:id` | protect (owner) | soft-delete → ack only (`{success, message}`) |
| POST | `/cart/summary` | protect | `{items: [{product_id, variant_id, quantity (1–99)}]}` → server-priced `CartSummary` |
| POST | `/orders/intent` | protect | `{items (min 1), shipping_address?}` → `{order, client_secret, publishable_key}` — prices server-side, enforces stock (409 `OUT_OF_STOCK` if insufficient), stores the address, creates a pending order + Stripe PaymentIntent. Idempotent: a repeat of the same cart reuses the open order |
| POST | `/orders/:id/confirm` | protect | verifies the PaymentIntent directly with Stripe, marks the order paid |
| GET | `/orders` | protect | history, newest first |
| GET | `/orders/:id` | protect | line items + totals breakdown, plus `shipping_address` and `fulfillment {status, tracking_number, carrier, shipped_at, delivered_at}` |

See [04-flows.md](04-flows.md) "Checkout" for why this is two calls, not one.
With no `STRIPE_SECRET_KEY` set, `/orders/intent` returns a clean 503 for any
non-zero total **and leaves no order behind** (the pending order + reserved
stock are rolled back); `$0` orders still complete end-to-end through a
`provider: 'none'` branch.

## Messaging

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/conversations` | protect | each item carries `is_group`/`title`/`participants`; `participant` set for 1:1, null for groups |
| POST | `/conversations/with/:id` | protect | open-or-create a 1:1 |
| POST | `/conversations/group` | protect | `{title, participant_ids (≥2)}` → 201; the caller's own id is implicit |
| GET | `/conversations/:id/messages` | protect | `?cursor=` |
| POST | `/conversations/:id/messages` | protect | `{body? (≤2000), image_url?}` — one of the two required |
| POST | `/conversations/:id/members` | protect | `{user_ids (≥1)}`, add members |
| PATCH | `/conversations/:id/members/:userId` | protect | `{role}`, promote/demote — UI-gated by caller's own role, enforced server-side too |
| DELETE | `/conversations/:id/members/:userId` | protect | remove; `:userId === "me"` = leave |

## Events

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/events` | protect | upcoming, soonest first |
| POST | `/events` | protect | `{title, description, starts_at (ISO), ends_at?, location_name, price_cents (≥0), latitude, longitude}` → 201; server assigns id/cover, geocodes venue |
| GET | `/events/:id` | protect | |
| POST / DELETE | `/events/:id/rsvp` | protect | free RSVP toggle |
| POST | `/events/:id/tickets/intent` | protect | no body → `{client_secret, publishable_key}`; a free event skips Stripe entirely |
| POST | `/events/:id/tickets/confirm` | protect | same two-step shape as commerce checkout |

## Calls

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| GET | `/calls/ice-servers` | protect | `{ice_servers}` — STUN (Google public, default) + TURN if configured. The app renames this to `iceServers` at the WebRTC boundary (`features/calls/api/webrtc.ts`), one of only two places it translates casing for an SDK |
| GET | `/calls` | protect | call log, newest first |
| POST | `/calls` | protect | `{peer \| null, is_group, participants, direction, is_video, outcome, started_at, duration_sec}` — exactly one of `peer`/`participants` must be populated (validator `superRefine`, mirrors the DB CHECK) |

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
| GET | `/admin/reports` | admin | `?status=&target_type=&cursor=`, the moderation queue |
| GET | `/admin/reports/:id` | admin | report + hydrated target (target resolved with `paranoid: false`, `null` if long gone) |
| POST | `/admin/reports/resolve` | admin | `{target_type, target_id, action: dismiss\|remove_content\|suspend_user, note? (≤500)}` — resolves **every pending report against that target** in one transaction |
| POST | `/admin/orders/:id/refund` | admin | refunds a settled order via Stripe and marks it refunded → Order. Idempotent; only a `succeeded` order can be refunded (else 409) |

`remove_content` soft-deletes a video / hard-deletes a comment;
`suspend_user` sets `is_active = false`, which `protect` turns into a 403 on
that user's next request.

## Uploads & devices

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| POST | `/uploads/sign` | protect | `{kind: video\|image\|avatar\|chat, content_type}` → a presigned S3 PUT URL. The API never proxies bytes — the client PUTs direct, sending the same `Content-Type` it signed for |
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
