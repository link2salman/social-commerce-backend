# Working on this repo

The API + realtime backend for **social-commerce-app** (sibling repo). Read this
before changing anything; for the design and the full contract see
[ARCHITECTURE.md](ARCHITECTURE.md), for setup see [README.md](README.md).

## Engineering standard: principal engineer, not patcher

- Fix root causes; no stub/placeholder implementations left behind when a real
  one is in scope. Real integrations (Stripe payments, Supabase Storage uploads,
  FCM push, geocoding, email, WebRTC ICE) are wired and **env-gated** — disabled
  with a clear 503/no-op until their key is set (see [INTEGRATIONS.md](INTEGRATIONS.md)).
  The remaining honest gaps: no HLS transcode pipeline (videos play as progressive
  MP4) and no SFU (group calls are signaling-only). Anything else should be real.
- Respect the layering (`routes → controllers → services → serializers/models`).
  New code fits the pattern or the pattern changes deliberately (and this file
  + ARCHITECTURE.md get updated).
- Verify changes: `npm run typecheck` and `npm run lint` must be clean, and
  exercise the endpoint (curl or the app) before calling it done.

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
6. **Seed** — extend `seeders/seedAll.ts` so the demo stays complete.
7. Typecheck, lint, `npm run migrate`, `npm run seed`, curl-verify shapes.

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
