# Integrations — the "fill these in" guide

Every real-world integration in this project is **wired end-to-end and disabled
until you provide its key**. The app and API both boot and run with none of them
set — each feature simply returns a clear 503 / no-op until configured. This file
is the single checklist of what to obtain and where to put it.

Legend: **B** = backend env (`iovibe-backend/.env.*`), **A** = app
(`iovibe-app/.env` + a file), **File** = a file you place.

> **Leave keys you haven't obtained *empty*, not placeholder-filled.** The
> gating checks whether a key is present, so a leftover `sk_test_...` or
> `my-bucket-name-here` constructs a live client that fails with a
> confusing provider auth error deep in a request, instead of the clean 503
> the feature is designed to return. Empty is a supported state; half-filled
> is not.

Backend keys are read from the `.env.*` file for the environment you're running
(`.env.development` for `npm run dev`, `.env.production` for a deploy). All
three templates list every key below, so you can fill in whichever you need
and leave the rest blank.

---

## 1. Database (PostgreSQL 14+) — required

Nothing provider-specific: the backend talks to Postgres through the `pg` driver,
so RDS/Aurora, Cloud SQL, DigitalOcean, or your own server all work identically.

| Where | Key | How to get it |
|---|---|---|
| B | `DATABASE_URL` | Your server's connection URL. If a **connection pooler** fronts it, use the pooler's **session-mode** port — transaction pooling breaks advisory locks, prepared statements in transactions, and LISTEN/NOTIFY |
| B | `DATABASE_DIRECT_URL` | Optional; only when a pooler is in play. The URL that bypasses it, used by migrations and `db-reset-remote.sh` (DDL needs session state). Falls back to `DATABASE_URL` |
| B | `DB_SSL_CA_PATH` | Your provider's CA bundle (AWS: the `rds-ca` global bundle). **Required in production** — see below |
| B | `DB_SSL_ALLOW_UNVERIFIED` | Blank by default. Set to `true` to *deliberately* accept a TLS link with no cert verification when you have no CA to hand |

Then: `npm run migrate:prod` and (optionally) `npm run seed:prod`.

**Local dev** uses the discrete `DB_*` vars — already filled in
`.env.development` — against the Postgres in `docker-compose.yml`:
`npm run db:up` starts `postgres:16` on `127.0.0.1:5433` with
`iovibe`/`iovibe`/`social_commerce_dev`. Port 5433 rather than 5432 because a
locally installed Postgres binds `127.0.0.1:5432` explicitly and would silently
win over Docker's wildcard bind. Any Postgres you already run works too — just
repoint `DB_*` and skip `db:up`.

> **Production DB TLS fails closed.** In production the backend **refuses to
> boot** with an unverified database link: you must set `DB_SSL_CA_PATH` to the
> provider CA bundle (so the certificate is actually validated), **or** set
> `DB_SSL_ALLOW_UNVERIFIED=true` to consciously accept an unverified TLS link.
> There is no silent-downgrade middle ground. Dev/test are unaffected.

## 2. Auth — required

| Where | Key | Notes |
|---|---|---|
| B | `JWT_SECRET` | 32+ random bytes. `openssl rand -base64 48` |

> **Production boot guard.** In production the backend refuses to start if
> `JWT_SECRET` is shorter than 32 characters or looks like a placeholder (e.g.
> `__CHANGE_ME__`, `dev-only-…`) — a weak signing key is a security hole, so a
> bad deploy fails fast and loud rather than serving traffic. Dev/test keep their
> short dev secrets.

## 3. Payments (Stripe) — physical goods + tickets

Stripe is the store-compliant processor for **physical goods and in-person
tickets** (Apple/Google *prohibit* IAP for these). From the Stripe Dashboard →
Developers.

| Where | Key | Notes |
|---|---|---|
| B | `STRIPE_SECRET_KEY` | `sk_test_…` then `sk_live_…` |
| B | `STRIPE_PUBLISHABLE_KEY` | `pk_…` — the backend hands this to the app; **no app env needed** |
| B | `STRIPE_WEBHOOK_SECRET` | `whsec_…` from a webhook pointing at `POST /v1/webhooks/stripe` (event: `payment_intent.*`) |

Nothing to set in the app — the PaymentSheet is initialized with the publishable
key returned in the checkout-intent response. Checkout works without a webhook in
dev (the confirm call verifies the PaymentIntent directly); add the webhook for
production reliability.

**Pricing tuning (non-secret, optional).** These are plain config with safe
defaults, not credentials — set them only if you want to change the demo rates:

| Where | Key | Notes |
|---|---|---|
| B | `TAX_RATE` | Flat sales-tax rate, default `0.08` (8%). **Not** real address-based tax — Stripe Tax / TaxJar are not integrated; this is a flat demo rate |
| B | `SHIPPING_FLAT_CENTS` | Flat shipping in cents, default `699` ($6.99) |

At the defaults, checkout pricing matches the app's mock byte-for-byte.

The **For You** ranker is also env-tunable (all optional, `RANK_*` — weights,
recency half-life, follow boost, candidate window). Defaults are sensible; see
`.env.example` and [DEFERRED-DECISIONS.md](DEFERRED-DECISIONS.md) §4.

## 4. Media storage (S3) — uploads

The client uploads bytes **straight to the bucket** through a short-lived
presigned PUT URL; the API server never proxies media.

| Where | Key | Notes |
|---|---|---|
| B | `S3_BUCKET` | Bucket name. **This is the gate** — empty means uploads 503 |
| B | `S3_REGION` | e.g. `us-east-1` (default) |
| B | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **Omit both** when the app runs with an EC2/ECS/EKS role — the SDK picks the role up automatically, which is preferred to long-lived keys. Set them only for a static IAM user |
| B | `S3_PUBLIC_BASE_URL` | Optional CDN domain in front of the bucket (CloudFront). Empty → the bucket's own S3 URL |
| B | `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` | Optional; for S3-compatible services (R2, Spaces, MinIO) |
| B | `S3_UPLOAD_URL_TTL_SECONDS` | Presigned URL lifetime, default `900` |

Nothing to set in the app — it receives the upload URL from
`POST /v1/uploads/sign`. Powers: video publishing, avatar/edit-profile, chat
image attachments, image/video posts.

`Content-Type` is signed into the URL, so the client must send the same value on
its PUT (S3 returns 403 otherwise) — that's what makes the stored object's type
the one the server validated rather than one the uploader chose.

### The bucket must be public to READ, private to WRITE

The URL we return is **persisted on the row** (a video's playback URL, a user's
avatar) and served indefinitely, so it cannot be a signed GET that expires.
Uploads, by contrast, only ever happen through our presigned URLs. So: turn off
"Block all public access" for the read path and attach a read-only policy —

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadMedia",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
  }]
}
```

Prefer a **CloudFront distribution** with Origin Access Control in front instead:
the bucket stays fully private, and you set `S3_PUBLIC_BASE_URL` to the
distribution domain. Leave ACLs disabled (bucket-owner enforced) either way — the
server signs no per-object ACL.

**CORS** — the mobile client PUTs cross-origin, so the bucket needs:

```json
[{
  "AllowedOrigins": ["*"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

**IAM** — the server only ever needs to *sign* PUTs, never to read or delete:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
  }]
}
```

A **lifecycle rule** is worth adding: expire incomplete multipart uploads after a
day, and consider transitioning old `video/` objects to Infrequent Access.

### Local dev without AWS

`docker-compose.yml` ships MinIO, an S3-compatible server. `npm run storage:up`
starts it and creates a public-read `media` bucket; then in `.env.development`:

```
S3_BUCKET=media
S3_ENDPOINT=http://127.0.0.1:9000
S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=iovibe-minio
AWS_SECRET_ACCESS_KEY=iovibe-minio-secret
```

Console at http://127.0.0.1:9001 (same credentials).

**Pick an endpoint the CLIENT can reach.** Both the presigned upload URL and the
public playback URL are derived from `S3_ENDPOINT`, so it must resolve from
wherever the bytes are actually PUT and fetched — which is the device, not the
server:

| `S3_ENDPOINT` | Reachable from |
|---|---|
| `http://127.0.0.1:9000` | the host only (curl, scripts, ts-node) |
| `http://10.0.2.2:9000` | the Android emulator only (its alias for the host) |
| `http://<your-LAN-IP>:9000` | **both** — get it with `ipconfig getifaddr en0` |

Use the LAN IP if you're switching between host tools and the emulator; the
trade-off is that it changes when you change networks. Setting
`S3_PUBLIC_BASE_URL` alone is *not* enough for the emulator — it fixes playback
and leaves the PUT pointing somewhere the device can't reach.

The SigV4 signature covers `host`, and MinIO validates it against the `Host`
header it receives — which matches, because the client really does connect to
whatever address you put here.

Note that `npm run dev` loads env through `dotenv-cli`, which **overrides** the
ambient environment: prefixing `S3_BUCKET=media npm run dev` has no effect, the
value in `.env.development` wins. Edit the file.

## 5. Push notifications (Firebase Cloud Messaging)

Create a Firebase project, add an Android app with package `com.ilaafonline.iovibe`
(the app's `applicationId`, in `android/app/build.gradle` — it must match exactly
or `google-services.json` is ignored and push silently never arrives).

| Where | Key | Notes |
|---|---|---|
| File (A) | `android/app/google-services.json` | Download from Firebase → Project settings. Build-time; the app still builds/runs without it (push stays off) |
| B | `FCM_SERVICE_ACCOUNT_BASE64` | Firebase → Service accounts → generate key → `base64 -i key.json` → paste |

Delivers offline pushes for new messages, incoming calls, follows, friend
requests; tapping deep-links into the app.

## 6. Maps + geocoding (Google Maps)

One Google Cloud API key with **Maps SDK for Android** + **Geocoding API** enabled.

| Where | Key | Notes |
|---|---|---|
| A | `GOOGLE_MAPS_API_KEY` (in `.env`) | Injected into AndroidManifest via the gradle manifestPlaceholder — the embedded event map |
| B | `GOOGLE_MAPS_API_KEY` | Server-side geocoding of event venues → map pins (can be the same key) |

Without it: the event screen falls back to a deep-link to the maps app, and
created events store null coordinates.

## 7. WebRTC calls (STUN / TURN)

STUN defaults to Google's public server (works on open networks). A **TURN** relay
is needed to connect across strict/symmetric NATs — get credentials from Twilio,
Metered, Cloudflare, or self-hosted coturn.

| Where | Key | Notes |
|---|---|---|
| B | `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | optional; served by `GET /v1/calls/ice-servers` |

## 8. Email (password reset) — optional

SMTP for the forgot/reset-password codes (SendGrid, Resend, SES, Mailgun, …).

| Where | Key |
|---|---|
| B | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` |

Without it, reset codes are generated but not delivered (endpoints still succeed).

## 9. Crash reporting (Sentry) — optional

Catches JS errors and native crashes in the app. Both have real free tiers.

| Where | Key | How to get it |
|---|---|---|
| A | `SENTRY_DSN` (in `.env`) | Sentry → Project → Settings → Client Keys (DSN) |

Without it the SDK is never initialised — no handlers, no network. The app
behaves exactly as if Sentry weren't installed. PII is scrubbed before send
(auth headers redacted, query strings stripped, request bodies never attached);
see `src/core/monitoring/sentry.ts`.

## 10. Product analytics (PostHog) — optional

| Where | Key | How to get it |
|---|---|---|
| A | `POSTHOG_API_KEY` (in `.env`) | PostHog → Project Settings → Project API Key |
| A | `POSTHOG_HOST` (in `.env`) | Only for self-hosted or the EU region (`https://eu.i.posthog.com`); blank = PostHog Cloud US |

Without a key the app uses a no-op analytics provider and the vendor SDK is
never constructed. Events are defined in one typed catalogue
(`src/core/analytics/events.ts`) carrying **ids and numbers only** — never
captions, message bodies, emails, or search queries.

## 11. Redis — optional (scaling)

| Where | Key | Notes |
|---|---|---|
| B | `REDIS_URL` | Enables the Socket.io adapter + shared rate-limit store across replicas. Single instance runs fine without it |

---

## Connecting the app to the backend

In `iovibe-app/.env`:

```
API_URL=http://10.0.2.2:5100/v1     # 10.0.2.2 = host from the Android emulator
WS_URL=ws://10.0.2.2:5100
USE_MOCK_API=false
GOOGLE_MAPS_API_KEY=...             # optional (maps)
```

Then **rebuild** (`npm run android`) — react-native-config bakes env in at build
time, and the native modules added for these features (Stripe, WebRTC, maps,
calendar, image-picker, Firebase) require a fresh native build.

## What still needs a real service (not code)

- A **media transcode pipeline** (HLS ladder) is not included — uploaded videos
  play as progressive MP4 straight from storage. Swap in Mux/Cloudflare Stream if
  you need adaptive bitrate.
- **Group-call media** is signaling-only (avatar UI); real group video needs an
  SFU. 1:1 calls carry real audio/video.
