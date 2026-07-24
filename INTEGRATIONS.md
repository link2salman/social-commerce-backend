# Integrations — the "fill these in" guide

Every real-world integration in this project is **wired end-to-end and disabled
until you provide its key**. The app and API both boot and run with none of them
set — each feature simply returns a clear 503 / no-op until configured. This file
is the single checklist of what to obtain and where to put it.

Legend: **B** = backend env (`social-commerce-backend/.env.*`), **A** = app
(`social-commerce-app/.env` + a file), **File** = a file you place.

> **Leave keys you haven't obtained *empty*, not placeholder-filled.** The
> gating checks whether a key is present, so a leftover `sk_test_...` or
> `https://<ref>.supabase.co` constructs a live client that fails with a
> confusing provider auth error deep in a request, instead of the clean 503
> the feature is designed to return. Empty is a supported state; half-filled
> is not.

Backend keys are read from the `.env.*` file for the environment you're running
(`.env.development` for `npm run dev`, `.env.production` for a deploy). All
three templates list every key below, so you can fill in whichever you need
and leave the rest blank.

---

## 1. Database (Supabase Postgres) — required

| Where | Key | How to get it |
|---|---|---|
| B | `DATABASE_URL` | Supabase → Settings → Database → **Session pooler** URL (port 5432) |
| B | `SUPABASE_DIRECT_URL` | Same page → **Direct connection** URL (used by migrations only) |
| B | `DB_SSL_CA_PATH` | Supabase → Settings → Database → **SSL certificate** (download `prod-ca-2021.crt`). **Required in production** — see below |
| B | `DB_SSL_ALLOW_UNVERIFIED` | Blank by default. Set to `true` to *deliberately* accept a TLS link with no cert verification when you have no CA to hand |

Then: `npm run migrate:supabase` and `npm run seed:supabase`. (Local dev uses the
discrete `DB_*` vars against a local Postgres instead — already set in
`.env.development`.)

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

## 4. Media storage (Supabase Storage) — uploads

Reuses your existing Supabase project. From Supabase → Settings → API.

| Where | Key | Notes |
|---|---|---|
| B | `SUPABASE_URL` | `https://<ref>.supabase.co` |
| B | `SUPABASE_SERVICE_ROLE_KEY` | **server-only**, never shipped to the app. The `media` bucket auto-creates (public) on first upload |

Powers: video publishing, avatar/edit-profile, chat image attachments.

## 5. Push notifications (Firebase Cloud Messaging)

Create a Firebase project, add an Android app with package `com.socialcommerceapp`.

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

In `social-commerce-app/.env`:

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
