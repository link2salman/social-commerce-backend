# Architecture — Social Commerce Backend

Node 20 · TypeScript · Express 4 · Sequelize 6 · PostgreSQL (Supabase) ·
Socket.io. Conventions mirror the sibling `ecommerce_node` reference backend;
the deliberate divergences (below) are forced by the mobile client.

## The client is the spec

The React Native app validates every response at its network boundary with Zod
(`parseResponse(promise, schema)` → `schema.parse(json)`). Two consequences
shape this whole backend:

1. **Raw response shapes, no envelope.** The app parses the *whole body*, so a
   success response IS the schema — `POST /auth/login` returns
   `{accessToken, refreshToken, userId}` at top level, `GET /feed/for-you`
   returns `{items, nextCursor}`, etc. We do **not** wrap success payloads in
   `{success, data}` (the reference backend does). Errors return an appropriate
   status with a small `{message}` body (the app treats any non-2xx as an error
   by status code and never parses the error body). All wire shapes are built by
   the `serializers/` layer — models are never `res.json()`'d directly.

2. **Refresh token in the JSON body, not a cookie.** A native client stores
   tokens in the Keychain, so `POST /auth/refresh {refreshToken}` takes the
   token in the body and returns a new `{accessToken, refreshToken, userId}`.
   The security model is the reference's — rotating refresh tokens, sha256
   storage, one-time rotation with reuse detection, device sessions,
   `assertAccessSessionActive` on every request — only the transport differs
   (`authSessionService.ts`). Access tokens are 15-minute JWTs carrying
   `{userId, jti, sessionId}`; a `401` drives the app's one-shot refresh.

Routes mount under **`/v1`** (`API_PREFIX`) — the path the app's `API_URL` ends
in.

## Layering

```
routes/       → HTTP wiring: path, middleware (protect, validate), controller
controllers/  → thin: read req, call a service, send the serialized result
services/     → all business logic + DB access (Sequelize), transactions
serializers/  → model → exact client wire shape (camelCase, money conversion)
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
  `shipping: 6.99`), events use **integer `priceCents`** (`3500`). Cart pricing
  (`pricingService`) replicates the mock's arithmetic byte-for-byte (flat
  $6.99 shipping, 8% tax, 2-dp rounding at each step).
- **Denormalized counters** on hot read paths (video like/comment/… counts,
  event attendee count) maintained inside the same transaction as the row that
  changes them. Viewer-specific flags (`hasLiked`, `isAttending`, `isFollowing`,
  `friendStatus`) are computed per request in batched queries (no N+1).

## Pagination

Cursor-based, keyset on `(created_at, id)` — stable under concurrent inserts.
The cursor is an opaque base64url token (`utils/cursor.ts`); the client
round-trips it via `?cursor=`. Feed page size 10, social lists 6 (matching the
app's `useInfiniteQuery` expectations). Non-paginated lists (friend-requests,
search, conversations, events, calls) return `{items}`.

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

## Supabase

`config/db.ts` builds one shared Sequelize instance from `DATABASE_URL` (or
discrete `DB_*`), enabling TLS for remote/prod connections. Use the **Session-mode
pooler** URL (port 5432) for the app — it speaks the full Postgres wire protocol
Sequelize needs (advisory locks, prepared statements in transactions). Run
**migrations against the direct connection** (`SUPABASE_DIRECT_URL`, port 5432,
`db.<ref>.supabase.co`) via `config/config.cjs` — the transaction pooler breaks
session-dependent DDL. `scripts/db-reset-supabase.sh` wipes + migrates a fresh
project.

## Endpoint map

```
Auth        POST /auth/{login,signup}            → Session {accessToken,refreshToken,userId}
            POST /auth/refresh {refreshToken}     → Session
            POST /auth/logout (protect)           → {ok} (blacklists the access
                                                    token + revokes the session)
            POST /auth/forgot-password {email}    → {ok} (always 200 — never
                                                    reveals who has an account)
            POST /auth/reset-password {email,code,password} → {ok}
Feed        GET  /feed/{for-you,following}?cursor= → FeedPage {items,nextCursor}
            POST /videos {videoUrl,thumbnailUrl?,caption,durationMs,
                          soundName?,filterId?,productIds?} → Video (201)
                                                  (`filterId` is stored but NOT
                                                   serialized back — see
                                                   "Write-only fields" below)
Engagement  POST|DELETE /videos/:id/{like,dislike,save,bookmark,favorite} → {ok}
Comments    GET  /videos/:id/comments  POST /videos/:id/comments {body,parentId?}
            GET  /comments/:id/replies  POST|DELETE /comments/:id/like
Reports     POST /reports {targetType,targetId,reason}
Social      GET  /users/:id | /:id/videos | /:id/{followers,following,friends}?cursor=
            GET  /users/search?q=   GET /friend-requests
            POST|DELETE /users/:id/follow   POST /users/:id/friend-request[/accept]
            DELETE /users/:id/friend   POST|DELETE /users/:id/block
Commerce    GET  /products  GET /products/:id
            POST /cart/summary {items} → CartSummary
            POST /orders/intent {items} → {order, clientSecret, publishableKey}
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
Calls       GET  /calls   POST /calls {peer,direction,isVideo,outcome,startedAt,durationSec}
            GET  /calls/ice-servers → {iceServers} (STUN/TURN from env)
Notifs      GET  /notifications?cursor=  → { items, nextCursor } (persisted feed)
            GET  /notifications/unread-count → { count }  (partial-index hit)
            POST /notifications/read {ids?} → { count }   (no ids = mark all)
Admin       GET  /admin/reports?status=&targetType=&cursor= → moderation queue
            GET  /admin/reports/:id  → report + hydrated target
            POST /admin/reports/resolve {targetType,targetId,action,note?}
                                     → { resolvedCount, action }
                                     (protect → requireAdmin; see "Moderation")
Uploads     POST /uploads/sign {kind,contentType} → signed Supabase Storage URL
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

`POST /videos` accepts a `filterId` — the camera filter the clip was shot with
(`'none' | 'vivid' | 'warm' | 'mono' | 'beauty'`, and whatever the app adds
next). It is persisted and **not** returned by `videoSerializer`.

That asymmetry is deliberate on both ends:

- **Stored**, because the app's filters are preview-only — VisionCamera records
  the unfiltered sensor stream, so the uploaded file has no filter baked in.
  Dropping the field would make the creator's choice unrecoverable the instant
  the clip is published. A future transcode step (the same ffmpeg/Mux worker
  that would replace the placeholder poster) is what would actually apply it.
- **Not serialized**, because the app's `VideoSchema`
  (`features/feed/schemas/video.schema.ts`) has no `filterId`. Zod strips
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
(with an idempotency key), and returns the `clientSecret` plus the publishable
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
  video (paranoid) or hard-deletes a comment (that model isn't paranoid);
  `suspend_user` sets `is_active = false`, which the auth middleware already
  turns into a 403 on the user's next request. Actions are validated against the
  target kind (`remove_content` on a user is a 400).
- The content action runs FIRST inside the transaction, so if it fails nothing
  is marked resolved.
- A report can outlive its target (deleted video, purged account) — the detail
  view resolves the target with `paranoid: false` and returns `null` rather than
  500ing.

## Testing

`tests/` — Jest + Supertest integration tests (**193 across 11 files**: auth,
social, chat, commerce, events, contract, probes) that mount the real Express
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
- A `contract` suite guards the no-envelope rule: success bodies must be the
  raw shape the app's Zod schemas parse.
- Integration-gated paths assert the **gate**, not a mock — e.g. a priced
  ticket 503s *and* creates no attendee row. A live-Stripe capture path is the
  one thing the suite cannot reach.

CI (`.github/workflows/ci.yml`) runs migrate → typecheck → lint → test on
Node 20 and 22 against a `postgres:16` service container, on every push and PR.
