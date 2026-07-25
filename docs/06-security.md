# Security overview

A single reference for how auth, sessions, and secrets work, gathered in one
place for a security review or a new team's first read. The design decisions
behind each piece are in [../ARCHITECTURE.md](../ARCHITECTURE.md); this doc
is the "what's true today" summary.

## Authentication model

- **Access tokens**: JWTs, 15-minute expiry, carrying `{userId, jti,
  sessionId}`. Signed with `JWT_SECRET` (HMAC). Sent as `Authorization:
  Bearer <token>`, with an `access_token` cookie accepted as a fallback.
- **Refresh tokens**: opaque random tokens, 30-day expiry, **never stored raw
  server-side** — only a sha256 hash lives in `user_sessions.refresh_token_hash`.
  Sent in the request body (`POST /auth/refresh {refreshToken}`), not a
  cookie — a deliberate divergence from the browser-oriented reference this
  backend's conventions are modeled on, forced by a native client storing its
  own token in Keychain rather than relying on cookie handling.
- **Rotation**: every refresh both revokes the presented session row and
  creates a new one (`rotation_count` increments). A refresh token that's
  replayed after rotation — the signature of a stolen token being used
  alongside the legitimate one — revokes the session with `reason:
  refresh_reuse` rather than silently succeeding twice.
- **Blacklist on logout**: `POST /auth/logout` hashes the *access* token it
  was called with and inserts it into `revoked_tokens`, so a token that's
  technically still within its 15-minute JWT expiry is rejected immediately
  rather than trusted until it naturally expires. `revoked_tokens.expires_at`
  mirrors the JWT's own `exp` purely so a cleanup job can prune rows that no
  longer matter — nothing currently runs that job (see "Open items" below).
- **Session enforcement on every request**: `protect` doesn't just verify the
  JWT signature — it also calls `assertAccessSessionActive(userId,
  sessionId)`, checking the session row isn't revoked/expired, and loads the
  user to check `is_active`. A suspended user (`is_admin` moderation action)
  or a device whose session was force-logged-out is rejected on the very next
  request, not just the next login.
- **Algorithm pinning**: every `jwt.verify` (HTTP middleware and the socket
  handshake) passes `algorithms: ['HS256']`, so a token's own `alg` header can
  never select the verifier.
- **Boot-time secret guard**: in production the app refuses to start
  (`assertBootConfig`) if `JWT_SECRET` is under 32 chars or looks like a
  placeholder — a weak signing key fails the deploy instead of shipping.
- **Sockets don't outlive their token**: an authenticated Socket.io connection
  is scheduled to disconnect at the access token's `exp`, so a long-lived
  socket can't outlast the credential that opened it (the client reconnects
  with a freshly-rotated token).

## Password handling

- bcrypt, cost factor from `BCRYPT_ROUNDS` (default 10).
- `User.toJSON()` strips `password_hash` unconditionally, so it can't leak
  through an accidental `res.json(userInstance)` anywhere in the codebase —
  this is enforced at the model level, not by remembering to `.select()`
  correctly in every service call.
- Password reset codes are 6 digits, sha256-hashed at rest
  (`password_reset_codes.code_hash`), single-use (`used_at`), and
  time-limited. `POST /auth/forgot-password` **always returns 200**,
  identically, whether or not the email belongs to an account — this is the
  one place in the API that deliberately withholds information a normal
  error response would leak.
- **A reset code is brute-force-capped**: `password_reset_codes.attempts`
  counts wrong guesses and the code is burned after 5, so the 10⁶ space can't
  be walked within a code's lifetime even by a rotating-IP attacker who evades
  the per-IP limiter.
- **A completed reset evicts existing sessions and tokens**
  (`revokeAllUserSessions('password_change')`) — the point of a reset is to
  lock out an attacker who already holds a token, so a stolen refresh token
  can no longer rotate and a stolen access token 401s on its next request.
- **Signup does not leak account existence**: a duplicate email *or* username
  returns the same generic 409 ("That email or username is already taken"), so
  the endpoint can't be used to enumerate registered emails. Login adds a dummy
  bcrypt comparison on an unknown email so response timing doesn't leak it
  either.

## Authorization

- **Ownership checks are per-resource in the service layer** — e.g. only a
  conversation's own members can post to it, only a group's owner/admin can
  add or remove members, only an order's owner can view its detail. There is
  no separate authorization framework; this is enforced inline in each
  service function.
- **Admin is a single boolean, not a role system**: `users.is_admin`.
  `requireAdmin` composes after `protect` — an anonymous request gets 401, a
  signed-in non-admin gets 403. There are exactly two privilege tiers in this
  system today.
- **The moderation action does real work, not a status flip**:
  `remove_content` soft-deletes a video or hard-deletes a comment;
  `suspend_user` flips `is_active`, which the *next* request from that user
  turns into a 403 via the same `protect` check every other request goes
  through — there's no separate "banned user" code path to keep in sync.

## Rate limiting

| Limiter | Scope | Limit |
|---|---|---|
| `authLimiter` | every `/auth/*` route | 40 requests / 15 min |
| `apiLimiter` | everything under `/v1` | 300 requests / 60s |

Both are keyed per-client (by IP, via `express-rate-limit`'s default
extractor, behind `trust proxy: 1`) and backed by Redis
(`rate-limit-redis`) when `REDIS_URL` is set — otherwise each process
enforces its own limit independently, which matters once you run more than
one instance (see [05-deployment-and-operations.md](05-deployment-and-operations.md)
"Scaling notes"). Disabled entirely for the test suite via `createApp({
disableRateLimit: true })`.

## Transport & headers

- `helmet()` is applied with `contentSecurityPolicy: false` — CSP is a
  browser mitigation and this API has no browser-rendered surface of its
  own; the other helmet defaults (HSTS, `X-Content-Type-Options`, etc.) still
  apply.
- CORS: browser `Origin` headers are checked against `FRONTEND_URLS`
  (comma-separated). **Requests with no `Origin` header are allowed
  unconditionally** — this is intentional, not an oversight: the native
  mobile app never sends an `Origin` header, so a strict CORS policy would
  block the actual client. This means CORS here is a browser-only
  protection; it provides no defense against a non-browser caller
  (curl, another server, a script), which is the same class of caller as the
  legitimate mobile app anyway. Don't rely on CORS as an authorization
  boundary for anything.
- TLS termination (for inbound HTTP) is **not** handled in this repo — see
  [05-deployment-and-operations.md](05-deployment-and-operations.md) "Current
  production shape."
- **The database link fails closed in production**: without `DB_SSL_CA_PATH`
  (a verified CA), the app refuses to boot rather than negotiating an
  unverified TLS connection that a MITM could sit on. `DB_SSL_ALLOW_UNVERIFIED=true`
  is an explicit, logged opt-out for the rare case that's acceptable.

## Data protection

- **Money is never trusted from the client.** Every price is computed
  server-side at checkout time, both for commerce (`pricingService`) and
  event tickets. The client sends item references and quantities, never an
  amount.
- **Payment data never touches this server.** Stripe's PaymentSheet collects
  card details directly in the app's native UI; this backend only ever sees a
  PaymentIntent id and its status.
- **AWS credentials are server-only** and must never be shipped to the app. The
  app holds no bucket credentials at all: every write goes through this backend's
  `/uploads/sign` endpoint, which returns a presigned PUT URL scoped to one
  object key and one Content-Type (both covered by the signature) and expiring in
  15 minutes. Signing the Content-Type matters on a public bucket: it stops an
  authenticated uploader from storing `text/html` under a `.jpg` key and getting
  attacker-controlled markup served from the media domain. Prefer an
  instance/task role over static keys, and scope the server's IAM policy to
  `s3:PutObject` on that bucket only — it never needs read or delete.
- **The media bucket is public for READ, and must not be public for WRITE.**
  Playback URLs are persisted on rows and served indefinitely, so objects are
  world-readable by design (via bucket policy or a CDN); nothing in that path
  should be treated as private. Anonymous `s3:PutObject` / `s3:DeleteObject` must
  never be granted — uploads are only ever authorized by our presigned URLs.
  Because keys embed the uploader's id (`{kind}/{userId}/{uuid}.{ext}`), do not
  put anything user-private in this bucket.
- **Soft-deleted (`paranoid`) content** (users, videos, products) still
  exists in the database after "deletion" — relevant for any data-retention
  or right-to-erasure requirement a real deployment needs to satisfy; this
  repo does not currently implement a hard-erasure path.

## What's in scope for a security review, concretely

- Auth/session flow end-to-end (`services/authSessionService.ts`,
  `middlewares/auth.ts`) — this is the highest-value place to spend review
  time; it's also the most-tested part of the system (see
  `tests/integration/`).
- Every `protect`/`requireAdmin` boundary against the endpoint list in
  [03-api-reference.md](03-api-reference.md) — confirm nothing sensitive is
  reachable without the auth middleware it should have.
- The webhook signature verification for `POST /webhooks/stripe` (raw-body
  mounting order in `app.ts` is load-bearing — moving it after
  `express.json()` silently breaks signature verification).
- Rate-limit coverage — confirm `authLimiter` actually covers every
  credential-guessing surface (login, signup, forgot-password, reset-password)
  as new auth-adjacent endpoints get added.

## Open items (not gaps in what's built, gaps in what's operated)

- No automated job prunes expired rows from `revoked_tokens` or
  `password_reset_codes` — they're small (bounded by JWT lifetime / code
  expiry) and don't affect correctness, but nothing currently cleans them up.
- No external error-tracking / alerting on the backend (see
  [05-deployment-and-operations.md](05-deployment-and-operations.md) "Logging").
  An auth failure spike or a Stripe webhook signature failure currently only
  shows up in raw logs, not a dashboard or a page.
- No secret-scanning or dependency-vulnerability scanning configured in CI
  today — `.github/workflows/ci.yml` runs migrate/typecheck/lint/test only.
