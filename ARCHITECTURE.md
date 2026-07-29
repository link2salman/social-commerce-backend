# Architecture — Social Commerce Backend

Node 20 · TypeScript · Express 4 · Sequelize 6 · PostgreSQL · S3 ·
Socket.io. Conventions mirror the reference backend at
`Ilaaf Online/io-backend`; the one deliberate divergence (below) is forced by
the mobile client.

## The response contract

Every response is wrapped in one envelope, built in `utils/responseHandler.ts`:

| Shape | Helper | Body |
|---|---|---|
| One resource | `sendSuccess` | `{ success, message, data }` |
| A collection | `sendList` | `{ success, message, items, ...extra }` |
| Offset page | `sendPaginated` | `… items, pagination: { total, page, limit, total_pages }` |
| Keyset page | `sendCursor` | `… items, next_cursor` |
| An error | `middlewares/error.ts` | `{ success: false, message, code, errors? }` |

Two rules that are easy to get wrong:

- **A collection stays FLAT.** `items` sits beside the envelope keys, never
  nested under `data`. That is what lets a page shape like `{ items,
  next_cursor }` survive the app's unwrap intact.
- **Every wire field is snake_case**, including inside JSONB columns that are
  passed straight through (`orders.shipping_address`,
  `call_records.participants`, `messages.attachment` — see the
  `jsonb-snake-case` migration). All wire shapes are built by the
  `serializers/` layer; models are never `res.json()`'d directly.

`/live` and `/health` are the exception — they are read by a load balancer, not
the app, and stay flat outside `/v1`. So is the Stripe webhook's
`{ received: true }`, which answers Stripe's contract, not ours.

### This reverses an earlier decision

This backend used to send **raw, unwrapped** bodies, on the reasoning that the
app Zod-parses the whole body so the response should *be* the schema. That was
real but it cost more than it saved: every response shape became its own
contract with nowhere to put `success`, a human message, or paging metadata, and
an error body carried nothing the client could branch on. The app now unwraps
the envelope in exactly one place (`core/api/client.ts` → `parseResponse`), so
feature schemas stayed as small as they were before. `tests/integration/
contract.test.ts` guards the new rule — it previously guarded the old one.

## Errors are codes, not messages

`middlewares/error.ts` maps every failure to a status plus a stable
`code` from `constants/errorCodes.ts`. The `message` is for humans and logs and
may be reworded freely; the **code is the contract**. The app branches on it and
renders its own copy (`core/api/errors.ts` → `ERROR_CODE_COPY`).

The distinction that earns its keep is in auth: `SESSION_EXPIRED` (access token
aged out — the app spends one silent refresh) versus `SESSION_INVALID` (bad
signature, revoked, rotated — log out, refreshing is pointless) versus
`INVALID_CREDENTIALS` (wrong password — show a form error, do not touch the
session). All three are 401s and were previously indistinguishable.

429 and 503 also set `Retry-After`, which the app turns into a real countdown.

Note this is a *superset* of the reference backend, which never emits a `code` —
so the `ERROR_CODE_COPY` map in `io-app` is unreachable there. Ours is not.

## The client is the spec

The React Native app validates every response at its network boundary with Zod
(`parseResponse(promise, schema)` → unwrap → `schema.parse(payload)`). A shape
that drifts from the app's schema throws in the app, not here — so serializers
match `features/*/schemas/*.schema.ts` field for field.

**Refresh token in the JSON body, not a cookie.** A native client stores tokens
in the Keychain, so `POST /auth/refresh { refresh_token }` takes the token in
the body and returns a new `{ access_token, refresh_token, user_id }` under
`data`. The security model is the reference's — rotating refresh tokens, sha256
storage, one-time rotation with reuse detection, device sessions,
`assertAccessSessionActive` on every request — only the transport differs
(`authSessionService.ts`). Access tokens are 15-minute JWTs carrying
`{userId, jti, sessionId}` (JWT *claims* are internal, not wire, so they stay
camelCase); a `401` drives the app's one-shot refresh.

Routes mount under **`/v1`** (`API_PREFIX`) — the path the app's `API_URL` ends
in.

## Layering

```
routes/       → HTTP wiring: path, middleware (protect, validate), controller
controllers/  → thin: read req, call a service, send the serialized result
services/     → all business logic + DB access (Sequelize), transactions
serializers/  → model → exact client wire shape (snake_case, money conversion)
models/       → Sequelize models (one shared instance, @config/db)
socket/       → Socket.io: auth handshake, chat + call-signaling handlers
middlewares/, validators/, utils/, constants/, config/
```

Dependency direction is one-way (`routes → controllers → services → models`).
Cross-domain reuse goes through an explicit export (e.g. chat and events reuse
`socialService.hydrateUserSummaries` for viewer-relative UserSummaries).

## Data model conventions

- `sequelize.define`, **UUID** PKs (`gen_random_uuid()` DB default), **snake_case**
  columns, `paranoid` soft-delete where content can be moderated
  (users, videos, products). Migrations are hand-authored JS — the source of
  truth for the schema; models never `sync()`.
- Table names + association aliases live in `utils/modelAlias.ts`; associations
  are wired centrally in `models/index.ts` (avoids circular-import juggling).
- **Money is integer minor units (cents)** in the DB, converted at the
  serialization boundary. The wire contract is deliberately mixed and honored
  exactly: commerce uses **major-unit dollar floats** (`price: 68`,
  `shipping: 6.99`), events use **integer `price_cents`** (`3500`). Cart pricing
  (`pricingService`) is computed entirely in **integer cents** —
  `subtotal + shipping + tax` always equals `total` exactly, with no
  floating-point drift — and converted to dollars only at the serializer
  boundary. The flat shipping and tax rate are env-configurable
  (`SHIPPING_FLAT_CENTS`, default `699`; `TAX_RATE`, default `0.08`); at the
  defaults the wire output is byte-for-byte identical to the app's mock
  ($6.99 shipping, 8% tax). Real address-based sales tax (Stripe Tax / TaxJar)
  is **not** implemented — the flat rate is a demo stand-in.
- **Denormalized counters** on hot read paths (video like/comment/… counts,
  event attendee count) maintained inside the same transaction as the row that
  changes them. Viewer-specific flags (`has_liked`, `is_attending`,
  `is_following`, `friend_status`) are computed per request in batched queries
  (no N+1). Note the *serializer input* types for these stay camelCase
  (`ctx.hasLiked`) — they're internal arguments, not wire fields.

## Pagination

Cursor-based, keyset on `(created_at, id)` — stable under concurrent inserts.
The cursor is an opaque base64url token (`utils/cursor.ts`); the client
round-trips it via `?cursor=`. Feed page size 10, social lists 6 (matching the
app's `useInfiniteQuery` expectations). Non-paginated lists (friend-requests,
search, conversations, events, calls) return `{items}`.

The **ranked "For You" feed** (`rankingService`) is the exception: it's ordered
by a computed per-viewer score (engagement · recency · author affinity), not a
column, so it uses a *ranked* cursor that carries a rank anchor + score (still
opaque base64url, same wire shape). "Following" stays keyset/chronological. See
[DEFERRED-DECISIONS.md](DEFERRED-DECISIONS.md) §4 for the scoring model and
what a learned recommender would add.

**Who is in each video timeline.** "For You" excludes the viewer's own videos
(`excludeAuthors = [viewerId, …blocked, …muted]`) — discovery is other people.
"Following" **includes** them: `[...followees, viewerId]`, the same author set
`postService.getPostFeed` has always used. Without that, a clip the user just
published appeared in no timeline at all and read as a failed upload; the app
compounded it by only ever calling `/feed/for-you`. If you ever make For You
include the viewer, drop the `excludes the viewer's own videos` case in
`tests/integration/feed.test.ts` deliberately — it is pinned there.

## Realtime (Socket.io)

One authenticated socket per session (JWT in the handshake `auth.token`, same
revocation + device-session checks as HTTP). Optional Redis adapter
(`@socket.io/redis-adapter`) federates rooms across instances when `REDIS_URL`
is set; otherwise in-memory single-instance. Every socket joins `user:<id>`.

- **Chat** (`socket/chatHandlers.ts`): conversation rooms + typing relay;
  `message:new` is emitted to each member's user room from `chatService` when a
  message is posted. (HTTP polling already makes chat fully functional; the
  socket is the real-time enhancement the app is wired for.)
- **Calls** (`socket/callHandlers.ts`): WebRTC signaling relay —
  `call:offer/answer/ice/ended` forwarded to the target user's room. `call:offer`
  is stamped with the caller's identity so the callee's incoming-call UI renders
  it, exactly the payload the app's `callSignaling.ts` listens for.

## PostgreSQL

`config/db.ts` builds one shared Sequelize instance from `DATABASE_URL` (or
discrete `DB_*`), enabling TLS for remote/prod connections. Any Postgres 14+ works
— there is no managed-provider SDK anywhere in `src/`, only the `pg` driver.
Locally, `docker-compose.yml` runs `postgres:16` on host port **5433**
(`npm run db:up`); production points `DATABASE_URL` at RDS, Cloud SQL, or a
self-hosted server.

If a **connection pooler** fronts the database, the app must use its
**session-mode** port: session mode speaks the full Postgres wire protocol
Sequelize needs (advisory locks, prepared statements inside transactions,
LISTEN/NOTIFY), and transaction pooling breaks those. Migrations run against the
**direct connection** (`DATABASE_DIRECT_URL`, falling back to `DATABASE_URL`) via
`config/config.cjs`, bypassing the pooler because DDL relies on session state.
`scripts/db-reset-remote.sh` wipes + migrates a fresh remote database;
`npm run db:reset` is the local twin.

## Media storage (S3)

`config/s3.ts` + `services/storageService.ts` mint **presigned PUT URLs** so the
client uploads bytes straight to the bucket — the API server never proxies media.
Keys are `${kind}/${userId}/${uuid}.${ext}`. The signature deliberately covers
**Content-Type** as well as bucket and key (`signableHeaders` — the presigner
omits it by default), so the client must echo the exact same Content-Type on its
PUT or S3 answers 403. That keeps the type the server validated as the type
actually stored and served back, instead of letting an authenticated uploader
park `text/html` on a public bucket.

Objects must be publicly **readable** and never publicly writable: the URL we
return is persisted on the row (a video's `hls_url`, a user's avatar) and played
back indefinitely, so it cannot be a signed GET that expires. Reads therefore go
through a bucket policy or a CDN (`S3_PUBLIC_BASE_URL`), while writes only ever
happen through our short-lived presigned URLs. No per-object ACL is signed —
modern buckets run with ACLs disabled (bucket-owner enforced).

Because it is plain S3, any S3-compatible service works via `S3_ENDPOINT`:
Cloudflare R2, DigitalOcean Spaces, or the MinIO in `docker-compose.yml` for
local dev (`npm run storage:up`).

## Endpoint map

Shapes below are the **payload** — what lands in `data`, or what sits beside
`items` for a collection. The `{success, message, …}` envelope wraps all of it;
`ack` means an envelope with no payload at all. See "The response contract" above.

```
Auth        POST /auth/{login,signup}            → Session {access_token,refresh_token,user_id}
            POST /auth/refresh {refresh_token}     → Session
            POST /auth/logout (protect)           → ack (blacklists the access
                                                    token + revokes the session)
            POST /auth/forgot-password {email}    → ack (always 200 — never
                                                    reveals who has an account)
            POST /auth/reset-password {email,code,password} → ack
Feed        GET  /feed/{for-you,following}?cursor= → FeedPage {items,next_cursor}
            POST /videos {video_url,thumbnail_url?,caption,duration_ms,
                          sound_name?,filter_id?,product_ids?} → Video (201)
                                                  (`filter_id` is stored but NOT
                                                   serialized back — see
                                                   "Write-only fields" below)
Engagement  POST|DELETE /videos/:id/{like,dislike,save,bookmark,favorite} → ack
            POST /videos/:id/share                → {share_count} (records a
                                                    share, increments the counter)
Comments    GET  /videos/:id/comments  POST /videos/:id/comments {body,parent_id?}
            GET  /comments/:id/replies  POST|DELETE /comments/:id/like
Posts       GET  /posts/feed?cursor= → PostFeedPage   (image/text/video feed,
                                                       following+self, chrono)
            GET  /posts/saved?cursor=   GET /posts/:id → Post
            POST /posts {body?, media:[{type,url,thumbnail_url?,duration_ms?}]} → Post (201)
            POST /posts/:id/share → {share_count}
            POST|DELETE /posts/:id/{like,dislike,save,bookmark,favorite} → ack
            GET  /posts/:id/comments  POST /posts/:id/comments {body,parent_id?}
            GET  /post-comments/:id/replies  POST|DELETE /post-comments/:id/like
            GET  /videos/saved?cursor=   GET /users/:id/posts?cursor=
Reports     POST /reports {target_type,target_id,reason}
                          (target_type: video|user|comment|post|post_comment)
Appeals     POST /appeals {target_type,target_id,reason}  (protect; user contests a
                          removed video/post they own)
            POST /appeals/suspension {email,password,reason}  (NO auth — a
                          suspended user is locked out, proves identity by creds)
Social      GET  /users/:id | /:id/videos | /:id/{followers,following,friends}?cursor=
            GET  /users/search?q=   GET /friend-requests
            POST|DELETE /users/:id/follow   POST /users/:id/friend-request[/accept]
            DELETE /users/:id/friend   POST|DELETE /users/:id/block
            POST|DELETE /users/:id/mute   (feed-level hide, softer than block)
Commerce    GET  /products  GET /products/:id
            POST /cart/summary {items} → CartSummary
            POST /orders/intent {items} → {order, client_secret, publishable_key}
                                                  (409 if a line exceeds stock;
                                                   idempotent per cart_hash)
            POST /orders/:id/confirm    → Order   (two-step: the app opens the
                                                   Stripe PaymentSheet between
                                                   them — see "Payments" below)
            GET  /orders   GET /orders/:id
Chat        GET  /conversations   POST /conversations/with/:id   POST /conversations/group
            POST /conversations/:id/members   PATCH|DELETE /conversations/:id/members/:userId
            GET  /conversations/:id/messages   POST /conversations/:id/messages
Events      GET  /events  GET /events/:id  POST /events {EventInput}
            POST|DELETE /events/:id/rsvp
            POST /events/:id/tickets/intent   POST /events/:id/tickets/confirm
                                                  (same two-step as orders; a
                                                   free event skips Stripe)
Calls       GET  /calls   POST /calls {peer,direction,is_video,outcome,started_at,duration_sec}
            GET  /calls/ice-servers → {ice_servers} (STUN/TURN from env)
Notifs      GET  /notifications?cursor=  → { items, next_cursor } (persisted feed)
            GET  /notifications/unread-count → { count }  (partial-index hit)
            POST /notifications/read {ids?} → { count }   (no ids = mark all)
Admin       GET  /admin/reports?status=&target_type=&cursor= → moderation queue
            GET  /admin/reports/:id  → report + hydrated target
            POST /admin/reports/resolve {target_type,target_id,action,note?}
                                     → { resolved_count, action }
                                     (protect → requireAdmin; see "Moderation")
            GET  /admin/appeals?status=&target_type=&cursor=  GET /admin/appeals/:id
            POST /admin/appeals/resolve {appeal_id,decision,note?} → { status }
                                     (grant reverses the action: reactivate user /
                                      restore video/post)
            POST /admin/orders/:id/refund → Order (protect → requireAdmin;
                                     idempotent; only a succeeded order refunds)
Uploads     POST /uploads/sign {kind,content_type} → presigned S3 PUT URL
                                                   (the API never proxies bytes;
                                                    the client PUTs direct)
Devices     POST|DELETE /devices {token,platform}  (FCM push registration)
Webhooks    POST /webhooks/stripe   — mounted in app.ts BEFORE express.json(),
                                      because signature verification needs the
                                      raw request bytes. Not under apiRouter.
WS          message:new, typing, call:offer/answer/ice/ended
Probes      GET /live (liveness)   GET /health (readiness: DB + Redis)
```

## Write-only fields: `videos.filter_id`

`POST /videos` accepts a `filter_id` — the camera filter the clip was shot with
(`'none' | 'vivid' | 'warm' | 'mono' | 'beauty'`, and whatever the app adds
next). It is persisted and **not** returned by `videoSerializer`.

That asymmetry is deliberate on both ends:

- **Stored**, because the app's filters are preview-only — VisionCamera records
  the unfiltered sensor stream, so the uploaded file has no filter baked in.
  Dropping the field would make the creator's choice unrecoverable the instant
  the clip is published. A future transcode step (the same ffmpeg/Mux worker
  that would replace the placeholder poster) is what would actually apply it.
- **Not serialized**, because the app's `VideoSchema`
  (`features/feed/schemas/video.schema.ts`) has no `filter_id`. Zod strips
  unknown keys, so adding it would be harmless — but "harmless" is not a reason
  to widen a contract. It goes on the wire when a client reads it.
- **Not an enum**, in the validator or the column (`VARCHAR(32)`, length-bounded
  only). The app owns the filter list; shipping a new filter there must not
  require a backend migration and deploy.

So it is an intentionally unconsumed column, documented at the write site in
`services/videoService.ts` and covered in `tests/integration/videos.test.ts` —
not dead weight to be tidied away.

## Payments: why checkout is two calls, not one

Money is never trusted from the client. `POST /orders/intent` prices the cart
server-side, creates the order in a pending state and a Stripe PaymentIntent
(with an idempotency key), and returns the `client_secret` plus the publishable
key — so the app needs no Stripe env var of its own. The app presents the
PaymentSheet, then calls `POST /orders/:id/confirm`, which verifies the
PaymentIntent's status directly with Stripe before marking the order paid.

That direct verification is why **checkout works in dev without a webhook**.
`POST /webhooks/stripe` exists for production reliability — it catches
payments that succeed after the app has been backgrounded or killed, which the
confirm call would otherwise miss. Event tickets follow the identical shape.

With no `STRIPE_SECRET_KEY` set, priced checkout returns a clean **503** and
creates nothing; `$0` orders and free events still complete end to end through
the `provider: 'none'` branch.

Three properties make `orders/intent` safe to call under real-world conditions:

- **Inventory is enforced.** The order is persisted inside a transaction that
  atomically decrements `products.stock` with a guarded
  `UPDATE … WHERE stock >= qty`. If any line can't be satisfied the update
  matches zero rows and checkout **409s** as a full no-op — no order, no stock
  change. Two checkouts racing for the last unit can't both win.
- **Compensating rollback on a failed intent.** If the order + items commit and
  stock is decremented but the Stripe PaymentIntent can't be created (Stripe
  off, or an API error), the order is deleted and the reserved stock is restored
  (`releaseOrder`) — a gated or failed checkout never leaves an orphan order or
  leaked inventory behind. The priced-checkout-with-Stripe-off 503 now has no
  side effect.
- **Idempotent against double-taps.** Each order stores a `cart_hash` (SHA-256
  of the canonical cart). A repeat checkout of the same cart by the same user
  reuses the existing still-unpaid order (and its live PaymentIntent) instead of
  minting a duplicate.

**Refunds** are an operator action: `POST /admin/orders/:id/refund`
(`protect → requireAdmin`) refunds the charge and marks the order `refunded`. It
is idempotent (a second call on an already-refunded order is a no-op) and only a
`succeeded` order can be refunded.

## Notifications

`notifications` is the **durable** counterpart to the FCM pushes the app already
receives: a push is transient (missed if the device is off), a feed row is not.
Rows are written from the same places the push fires (`socialService.follow`,
friend request/accept, `commentService.postComment`) so the two channels can't
disagree, and `NOTIFICATION_TYPES` doubles as the push `data.type` the app routes
a tap on — one vocabulary for both.

- Polymorphic target (`target_type` + `target_id`, no FK), like `reports`.
  Deliberately narrower than report targets: only `user` and `video`, because
  those are the only surfaces the client can actually open.
- Never notify a user of their own action — guarded in the service AND by a
  `notifications_no_self` CHECK, so a future caller that forgets can't.
- Two indexes: a keyset for the list, and a **partial** index on unread rows.
  The badge is polled far more often than the list is read, and a partial index
  stays small no matter how much history accumulates.
- **Chat messages deliberately create no rows.** The inbox already owns
  per-conversation unread state; mirroring every message here would drown the
  social signals the feed exists for and split "unread" across two sources of
  truth.

## Moderation

`POST /reports` (app) writes; the `/admin` surface reads and resolves. Before
this existed, reports were insert-only with no consumer.

- **A single `is_admin` boolean, not a role system.** There are exactly two kinds
  of actor here; RBAC would be a speculative abstraction. `requireAdmin`
  composes after `protect` — anonymous 401s, a signed-in non-moderator 403s.
- **The unit of moderation is the TARGET, not the report.** A viral bad video is
  reported dozens of times; resolving those one-by-one isn't usable. So
  `POST /admin/reports/resolve` takes a target and closes *every* pending report
  against it in one transaction, performing the action once.
- Actions do real work, not just a status flip: `remove_content` soft-deletes a
  video or **post** (both paranoid) or hard-deletes a comment / **post comment**
  (those models aren't paranoid); `suspend_user` sets `is_active = false`, which
  the auth middleware already turns into a 403 on the user's next request. Actions
  are validated against the target kind (`remove_content` on a user is a 400).
- Targets are polymorphic (no FK): `REPORT_TARGET_TYPES = video|user|comment|post
  |post_comment`. Posts are a **parallel content stack** to videos (their own
  `posts`/`post_media`/`post_engagements`/`post_comments` tables), so they plug
  into moderation by extending the enum, not by refactoring the tested video path.
- The content action runs FIRST inside the transaction, so if it fails nothing
  is marked resolved.
- A report can outlive its target (deleted video, purged account) — the detail
  view resolves the target with `paranoid: false` and returns `null` rather than
  500ing.
- **Appeals** contest an action: `POST /appeals` (a removed video/post the user
  authored, ownership-checked) or `POST /appeals/suspension` (unauthenticated, by
  credentials, since a suspended user can't log in). `POST /admin/appeals/resolve`
  grants — reversing the action (reactivate user / restore the soft-deleted
  video/post) inside the same transaction — or denies.

## Testing

`tests/` — Jest + Supertest integration tests (**290 across 19 files**: auth,
social, feed, posts, comments, moderation, appeals, chat, commerce, events,
contract, probes) that mount the real Express
app via `createApp({ disableRateLimit: true })` and run against a real
PostgreSQL. There are no unit tests and deliberately no mocked database: the
contract this backend must honor is HTTP-shaped, and Sequelize/Postgres
behavior (transactions, unique indexes, cascades) is part of what needs
verifying.

- `npm test` is self-contained — `globalSetup` creates the test database if
  absent and applies migrations. It refuses to run unless `DB_NAME` looks like
  a test database, because the suite TRUNCATEs every table between files.
- Truncation is driven off `utils/modelAlias.tableNames`, so a new domain table
  is covered automatically when you add one.
- `tests/helpers/factories.ts` builds fixtures through the real API (signup,
  follow, post) rather than raw inserts, so tests exercise the same paths the
  app does.
- A `contract` suite guards the envelope: success bodies carry
  `{ success, message, … }`, collections keep `items` flat, errors carry a
  `code`, and a recursive walk asserts **no camelCase key anywhere** on the
  wire — cheaper and broader than naming fields one at a time.
- Integration-gated paths assert the **gate**, not a mock — e.g. a priced
  ticket 503s *and* creates no attendee row. A live-Stripe capture path is the
  one thing the suite cannot reach.

CI (`.github/workflows/ci.yml`) runs migrate → typecheck → lint → test on
Node 20 and 22 against a `postgres:16` service container, on every push and PR.
