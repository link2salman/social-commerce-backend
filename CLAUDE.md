# Working on this repo

The API + realtime backend for **social-commerce-app** (sibling repo). Read this
before changing anything; for the design and the full contract see
[ARCHITECTURE.md](ARCHITECTURE.md), for setup see [README.md](README.md).

## Engineering standard: principal engineer, not patcher

- Fix root causes; no stub/placeholder implementations left behind when a real
  one is in scope. Real integrations (Stripe payments, Supabase Storage uploads,
  FCM push, geocoding, email, WebRTC ICE) are wired and **env-gated** — disabled
  with a clear 503/no-op until their key is set (see [INTEGRATIONS.md](INTEGRATIONS.md)).
  The remaining gaps are enumerated in [README.md](README.md#honest-gaps) —
  keep that list honest and current. Anything not on it should be real.
- Env-gated means **empty**, not dummy-valued. A placeholder like
  `STRIPE_SECRET_KEY=sk_test_...` constructs a live client that fails with a
  provider auth error instead of the clean 503 the design promises. Leave gated
  keys blank in every `.env.*` template.
- Respect the layering (`routes → controllers → services → serializers/models`).
  New code fits the pattern or the pattern changes deliberately (and this file
  + ARCHITECTURE.md get updated).
- Verify changes: `npm run typecheck`, `npm run lint`, and `npm test` must be
  clean, and exercise the endpoint (curl or the app) before calling it done.
  A new endpoint without a test in `tests/integration/` is not done.

## The client is the spec — do not break the contract

The mobile app validates every response with Zod at its boundary. A response
whose shape drifts from the app's schema throws in the app, not here. So:

- Build every wire shape in `serializers/` and match the app's schema exactly
  (camelCase, nullable-vs-optional, money units — commerce is dollar floats,
  events are integer `priceCents`). When in doubt, read the app's
  `features/*/schemas/*.schema.ts` — it is the source of truth.
- Success responses are the RAW shape (no `{success,data}` envelope). Errors go
  through `middlewares/error.ts` (an `AppError` subclass → status + `{message}`).
- New endpoints mount under `/v1` and, unless truly public, use `protect`.

## Adding a feature (the pattern)

1. **Migration** (`npm run make-migration <name>`) — hand-write the schema.
2. **Model(s)** in `models/<domain>/`, table name + assoc aliases in
   `utils/modelAlias.ts`, associations wired in `models/index.ts`.
3. **Serializer** — the exact wire shape.
4. **Service** — business logic + DB access; transactions for multi-write ops;
   maintain any denormalized counters in the same transaction.
5. **Validator** (Zod) + **controller** (thin) + **route** (mounted in
   `routes/index.ts`, literals before `:param` routes).
6. **Seed** — extend `seeders/seedAll.ts` so the demo stays complete. Insert
   real rows and derive any denormalized counter from them (see how
   `seedEngagements` reconciles counts with a `GROUP BY`) — never hand-write a
   counter, or the demo will show counts that disagree with viewer flags.
7. **Test** — add to `tests/integration/<domain>.test.ts`. Cover the happy
   path, the auth failure, the validation failure, and ownership/permission
   enforcement (another user must not reach it). Build fixtures through the
   real API via `tests/helpers/factories.ts`, not raw inserts.
8. Typecheck, lint, `npm test`, `npm run migrate`, `npm run seed`,
   curl-verify shapes.

## Tests

`npm test` — Jest + Supertest against a real PostgreSQL, no mocked DB. It
creates and migrates `social_commerce_test` itself and TRUNCATEs between files
(which is why it refuses to run unless `DB_NAME` looks like a test database).

- Each test file truncates in `beforeAll` and builds its own fixtures — never
  assert against seeded data, and never depend on another file's rows.
- `GET` collection endpoints are global: if you assert on a list, assert the
  *contract* (ordering, shape) plus the relative position of rows you created,
  not absolute counts.
- Don't mock an integration to make a happy path go green — that tests the
  mock. Test the real branches (`$0` orders and free events run intent→confirm
  for real) and assert the **gate** on the rest: a 503 must also leave no side
  effect behind.
- New domain table? Truncation picks it up automatically via
  `utils/modelAlias.tableNames` — but add it there, or it will leak between tests.

## Local workflow

- Postgres on localhost (`.env.development` targets `social_commerce_dev`).
  `npm run migrate` then `npm run seed`; `npm run dev` watches.
- `npm run seed` is a full reset (TRUNCATE users CASCADE + re-insert) — safe to
  run anytime in dev; it also logs everyone out (clears sessions).
- Money is stored in **cents**; convert only at the serializer boundary
  (`utils/money.ts`). Never send cents where the app expects dollars.

## Deploy (Supabase)

App connection = Session-mode pooler URL (5432); migrations = direct URL. See
README → Deploy and `scripts/db-reset-supabase.sh`. Rotate `JWT_SECRET` only
deliberately — it invalidates every live access token.
