# Glossary

Terms used precisely and consistently across the codebase and this
documentation, defined once here rather than re-explained inline everywhere.

| Term | Meaning |
|---|---|
| **The app** / **the client** | `iovibe-app`, the React Native mobile app — the sibling repo. Referred to as "the client" specifically when contrasting it with this server. |
| **This backend** / **the API** | `iovibe-backend`, this repo. |
| **Mock API / mock mode** | The app's in-process fake API (`USE_MOCK_API=true`, its default). Lets the app run with no server at all. Not scaffolding — a deliberate offline dev mode. Only exists in the app repo. |
| **The client is the spec** | The governing design rule: every response shape here must match the Zod schema the app already validates against. See [../ARCHITECTURE.md](../ARCHITECTURE.md). |
| **Envelope** | A wrapper like `{success, data}` around a response body. This API deliberately does **not** use one — success bodies are the raw shape. |
| **Paranoid** (Sequelize term) | Soft-delete: a `deleted_at` column marks a row as gone without removing it. Applies to `users`, `videos`, `products`. |
| **Denormalized counter** | A count (likes, comments, attendees) stored on the parent row and updated in the same transaction as the event that changes it, rather than computed with `COUNT(*)` at read time. |
| **Keyset pagination / cursor** | Pagination by `(created_at, id)` rather than `OFFSET` — stable under concurrent inserts. The cursor is an opaque base64url token (`utils/cursor.ts`); a client never constructs or parses one, only round-trips it. |
| **Write-only field** | A field the API accepts and stores but deliberately never serializes back in a response — currently only `videos.filter_id`. See [../ARCHITECTURE.md](../ARCHITECTURE.md) "Write-only fields." |
| **Polymorphic target** | A `(target_type, target_id)` pair referencing one of several possible tables with no foreign-key constraint — used by `reports` and `notifications`. |
| **Frozen snapshot** | Data copied into a row at write time so it survives the original source row changing or being deleted later — e.g. `call_records.participants`, `order_items.title`/`variant_name`. Contrast with a live join, which would reflect the *current* state of the referenced row. |
| **Session** (in `user_sessions`) | One row per device/login — tracks a single refresh token's lifecycle. Not an HTTP session or a cookie session; unrelated to Express `session` middleware (none is used here). |
| **Rotation** (refresh tokens) | Every use of a refresh token both revokes it and issues a new one. Prevents indefinite reuse of a single refresh token and makes theft detectable (a second use of an already-rotated token is reuse, not a valid refresh). |
| **Blacklist** (`revoked_tokens`) | Access tokens explicitly invalidated before their natural 15-minute JWT expiry — e.g. on logout. |
| **Provider-agnostic / env-gated integration** | A third-party integration (Stripe, FCM, SMTP, etc.) that returns a clean 503 or no-op when its key is absent, rather than crashing or behaving unpredictably. Every integration in this backend follows this pattern — see [../INTEGRATIONS.md](../INTEGRATIONS.md). |
| **SFU** (Selective Forwarding Unit) | A media server that receives each participant's stream once and forwards it to the others — the standard way to scale a video call past ~3-4 participants, where a peer-to-peer mesh stops working. Not built here; see [../DEFERRED-DECISIONS.md](../DEFERRED-DECISIONS.md). |
| **HLS** (HTTP Live Streaming) | An adaptive-bitrate video format (a manifest + multiple resolution renditions) as opposed to a single progressive MP4 file. Not implemented here despite the `hls_url` column name — see [../DEFERRED-DECISIONS.md](../DEFERRED-DECISIONS.md). |
| **Session-mode pooler vs. direct connection** | Two connection strings to the same Postgres server when a connection pooler (PgBouncer et al.) fronts it. The app uses the pooler's session-mode port (`DATABASE_URL`); migrations use the direct connection (`DATABASE_DIRECT_URL`) because transaction pooling breaks session-dependent DDL. Irrelevant if you connect straight to Postgres. See [05-deployment-and-operations.md](05-deployment-and-operations.md). |
| **Money in minor units / cents** | Prices stored as integers (e.g. `6800` = $68.00) to avoid floating-point rounding error, converted to the wire format only at serialization. Commerce serializes to dollar floats on the wire; events serialize integer cents on the wire too — a deliberate, documented inconsistency, not a bug. |
| **Target** (moderation) | The specific user/video/comment a report or notification refers to, via `(target_type, target_id)`. Moderation resolves *all pending reports against a target* in one action, not one report at a time. |
| **Demo / seeded accounts** | The 16 fixture users created by `npm run seed`, login `{username}@demo.social` / `password123` — for local development and demos only, never present in a real production database. |
