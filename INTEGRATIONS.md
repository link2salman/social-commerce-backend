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
| B | `UPLOAD_MAX_VIDEO_MB` / `UPLOAD_MAX_IMAGE_MB` / `UPLOAD_MAX_AVATAR_MB` / `UPLOAD_MAX_CHAT_MB` | Size ceiling per upload `kind`. Defaults `150` / `25` / `8` / `15`. Checked at sign time **and** signed into the URL |
| B | `VIDEO_MAX_DURATION_MS` | Longest publishable clip, default `90000` (the app's 60 s recording cap plus headroom) |

Nothing to set in the app — it receives the upload URL from
`POST /v1/uploads/sign`. Powers: video publishing, avatar/edit-profile, chat
image attachments, image/video posts.

`Content-Type` **and `Content-Length`** are signed into the URL, so the client
must send the same values on its PUT (S3 returns 403 otherwise). Signing the type
is what makes the stored object's type the one the server validated rather than
one the uploader chose. Signing the length is what bounds the upload: a presigned
PUT has no size-range condition (that only exists for presigned POST, a different
wire shape), so an exact signed byte count is the one real ceiling available —
which is why the sign request carries `content_length` and the client must PUT
precisely that many bytes.

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

**IAM** — signing PUTs is no longer all the server does. The transcode worker
reads originals and writes renditions itself, and the retention sweep has to list
the bucket to find objects the database does not reference. Every action below is
required by a real call in `services/storageService.ts`:

| Action | Resource | Who needs it |
|---|---|---|
| `s3:PutObject` | `…/*` | `createSignedUpload` (the presigned PUT is only valid if the *signing* identity holds this) **and** `putObject`, which is how the worker stores each rendition and poster |
| `s3:GetObject` | `…/*` | `getObjectBytes` — the worker downloads the original to feed ffmpeg. It is not a browser holding a signed URL; a public-read bucket policy does not cover it, and behind CloudFront-with-OAC the bucket is private anyway |
| `s3:ListBucket` | the **bucket**, not `…/*` | `listAllObjects` — the sweep is bucket-minus-database, so it must enumerate. Note the resource: `ListBucket` is a bucket-level action and silently denies if you scope it to `…/*` |
| `s3:DeleteObject` | `…/*` | `deleteObjects` — reclaiming orphans and superseded originals |

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ObjectReadWrite",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
    },
    {
      "Sid": "ListForRetentionSweep",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::YOUR_BUCKET"
    }
  ]
}
```

All four are now required. `s3:DeleteObject` used to be the one you could
defensibly drop, back when the only scheduled sweep was report-only — that is no
longer true. `iovibe-sweep-reclaim.timer` runs `sweep:media --delete` nightly
against orphans unreferenced for 7+ days, so without `DeleteObject` that job
fails every night and storage grows unbounded while the report keeps insisting
there are orphans to collect. `GetObject` and `ListBucket` are not optional — omit `GetObject`
and every transcode job fails its retries with an access-denied error while
publishing continues to look healthy, which is exactly the kind of silent failure
this section used to cause.

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

## 7. WebRTC calls (STUN / TURN) — self-hosted, no account, no bill

**There is nothing to sign up for here.** Unlike every other section in this
file, TURN is not a third-party service: `deploy/provision.sh` installs
**coturn on the VPS this API already runs on**, generates the shared secret,
writes `/etc/turnserver.conf`, opens the firewall ports and fills the keys into
`/etc/iovibe/api.env`. Provision the server and calls relay. The only cost is
bandwidth on a box you already pay for — see *What relaying actually costs*
below, which is not zero and you should read it.

STUN alone (Google's public server, the default) connects two peers when at
least one of them is reachable at a predictable address. **Two phones on mobile
data are not.** Carrier-grade NAT is symmetric: the address each side learns
from STUN is bound to the STUN server's socket and is useless to the other peer.
Those calls ring, negotiate, and connect nothing. TURN fixes it by being the
reachable address for both — every packet goes through the relay.

| Where | Key | Notes |
|---|---|---|
| B | `TURN_URLS` | Comma-separated. Written by `provision.sh` as `turn:<server>:3478?transport=udp,turn:<server>:3478?transport=tcp` (+ `turns:…:5349?transport=tcp` when a certificate exists) |
| B | `TURN_STATIC_AUTH_SECRET` | coturn's `static-auth-secret`. Generated once into `/etc/iovibe/api.env` **and** `/etc/turnserver.conf` — the two must be equal. Kept in `/etc/iovibe/.turnsecret` so re-running `provision.sh` never rotates it |
| B | `TURN_CREDENTIAL_TTL_SECONDS` | Lifetime of a minted credential. Default `43200` (12 h) |
| B | `STUN_URLS` | `provision.sh` puts your own coturn first and leaves Google's as the fallback |
| B | `TURN_USERNAME` / `TURN_CREDENTIAL` | **Leave blank.** Only for a relay that offers no shared secret; ignored while `TURN_STATIC_AUTH_SECRET` is set |

Nothing to set in the app — it calls `GET /v1/calls/ice-servers` and feeds the
result straight into `RTCPeerConnection`.

### The credential is minted, never stored

`use-auth-secret` (coturn's REST-API mechanism) means the server does not keep a
user table. Each `GET /v1/calls/ice-servers` returns

```
username   = <unix-expiry>:<userId>
credential = base64(HMAC-SHA1(username, TURN_STATIC_AUTH_SECRET))
```

and coturn recomputes the same HMAC to verify it (`services/callService.ts`).
This is the whole reason not to configure a fixed username/password: **a static
TURN credential inside a mobile app binary is trivially extracted from the APK
and never expires** — whoever pulls it out has a free relay running on your
VPS's bandwidth, indefinitely and anonymously. A minted credential dies in 12 h
and names the account it was issued to, so `user-quota` bounds it and the logs
attribute it. 12 h because it must comfortably outlive any call (coturn checks
the expiry when the allocation is made) while a leaked one is worthless by
tomorrow.

### Verifying it actually relays

Configured is not the same as working — a firewall rule missing on the relay
port range produces a relay candidate that carries no media, which looks exactly
like a working relay right up until the call is silent.

1. **The daemon is up and enabled:**
   ```bash
   systemctl status coturn
   ss -lnup | grep 3478           # a UDP listener must be there
   journalctl -u coturn -f        # then place a real call and watch
   ```
   A common failure is Debian/Ubuntu shipping coturn *disabled*: `/etc/default/coturn`
   carries a commented-out `TURNSERVER_ENABLED`, and without it the daemon never
   starts. `provision.sh` sets it.

2. **`turnutils_uclient`** ships with the coturn package. Run it **from a
   machine that is not the server** (`apt install coturn` locally; from the
   server itself you would be testing loopback, which the config denies), using
   a username/credential straight out of `GET /v1/calls/ice-servers`:
   ```bash
   turnutils_uclient -v -u '<username>' -w '<credential>' -p 3478 <server>
   ```
   Success prints an allocated relay address and a completed round trip. `401`
   means the secret in `api.env` and `turnserver.conf` disagree, or the
   credential's expiry has passed.

3. **The real check — a `relay` candidate.** Open the WebRTC samples
   **[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)**
   page, remove the default server, add `turn:<server>:3478` with the same
   username/credential, and *Gather candidates*. You need at least one row of
   type **`relay`**. `srflx` only means STUN worked and TURN did not — that is
   the exact state that fails between two phones on mobile data.

### What relaying actually costs (read this)

- A relayed 1:1 **video** call is roughly **1–3 Mbit/s in each direction through
  the server** — the relay receives a stream and sends it out again, so it pays
  for the traffic twice. Audio-only is ~50–100 kbit/s.
- **Only calls that cannot go peer-to-peer are relayed.** WebRTC always prefers
  a direct path; the relay is the last ICE candidate tried. In the wild that is
  commonly quoted at **~10–20% of calls**, and it rises with the share of users
  on mobile data — for two users who are both on cellular, expect relaying to be
  the norm rather than the exception.
- **Quotas are what bound the worst case**, and `provision.sh` sets them:
  `bps-capacity` (20 Mbit/s server-wide by default ≈ 10 concurrent relayed video
  calls, ~6.5 TB/month if saturated around the clock), `max-bps` (4 Mbit/s per
  session), `user-quota`/`total-quota` on allocations, and a relay port range of
  ~100 ports. Raise them against your VPS's actual transfer allowance. Past the
  ceiling, coturn refuses new allocations — calls that need a relay fail rather
  than the box's bandwidth bill running away.

### Hardening that is not optional

An unrestricted TURN server forwards UDP to any address a client names, which
makes it a general-purpose **SSRF pivot sourced from inside your network**: an
attacker with a credential could aim it at `127.0.0.1:5434` (this box's
PostgreSQL), `127.0.0.1:5200` (the API behind nginx), or `169.254.169.254`
(cloud metadata). `/etc/turnserver.conf` therefore denies every RFC1918,
loopback, link-local, CGNAT, multicast and reserved range — **including
IPv4-mapped IPv6 (`::ffff:0:0/96`)**, which is otherwise the way straight past
all of the IPv4 rules. The admin telnet CLI is off (`no-cli`), TCP *relay*
allocations are refused (`no-tcp-relay`), and the config file is `0640
root:turnserver` because it contains the shared secret.

### TLS on 5349

Only if IOVibe has a **domain** with a certificate. A `turns:` URL is verified
against a hostname and no CA issues certificates for bare IP addresses, so while
`SERVER_NAME` is the server's IP there is nothing to serve TLS with — the
provisioned relay is plain TURN on 3478, **UDP and TCP**. That relays every call
perfectly well; what it does not do is look like HTTPS to a corporate firewall
that only allows 443.

Once a domain and a certbot certificate exist, re-running `provision.sh` picks
the certificate up automatically and reuses **nginx's own** — with two
consequences it handles for you: coturn runs as the unprivileged `turnserver`
user, so it is granted group read on IOVibe's certificate lineage only, and a
renewal (every ~60 days) writes a fresh root-only private key that would break
that grant. A certbot deploy hook re-applies it and restarts coturn — a restart,
because coturn does not re-read its certificate in place. That restart drops any
call being relayed at that instant, roughly once every two months.

### Not using the provisioned relay?

The code path is provider-agnostic. Any coturn with `use-auth-secret` works —
set `TURN_URLS` + `TURN_STATIC_AUTH_SECRET`. A relay that offers only a fixed
username/password still works via `TURN_USERNAME`/`TURN_CREDENTIAL`, and the
server logs a warning saying why that is worse. With `TURN_URLS` empty the API
serves STUN only and logs the consequence; with `TURN_URLS` set and no
credentials of either kind it logs an error and **omits** the relay rather than
emitting a half-configured entry that would be dialled and refused.

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
