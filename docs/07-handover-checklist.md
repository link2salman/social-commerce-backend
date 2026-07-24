# Handover checklist

Start here if you're taking over this system. This is the backend/infra half
of the handover — the mobile app has its own checklist (store accounts,
signing keystore, Firebase Android app) at
[../../social-commerce-app/docs/06-handover-checklist.md](../../social-commerce-app/docs/06-handover-checklist.md).
Go through both.

## Accounts and access to transfer

For each row: get it transferred to an account the new team controls, or at
minimum get added as an owner/admin — don't operate long-term on the previous
owner's personal account.

| Account | Used for | Where |
|---|---|---|
| Supabase project | Postgres database + media storage | supabase.com — Settings → Team, add as owner |
| Stripe account | Payments (checkout, event tickets) | dashboard.stripe.com — Settings → Team |
| Firebase project | Push notifications (FCM) | console.firebase.google.com — Project settings → Users and permissions |
| Google Cloud project (Maps/Geocoding) | Event venue geocoding + the app's embedded map | console.cloud.google.com — IAM |
| SMTP provider (SendGrid/Resend/SES/etc., whichever was chosen) | Password reset emails | provider's dashboard |
| Domain / DNS for `API_URL` | Where the backend is actually reachable | registrar / DNS host |
| Hosting/deploy target (wherever PM2 runs) | Running the production process | depends what was chosen — see "Open question" below |

## Credentials to rotate on handover

Any credential the outgoing team had access to should be rotated the moment
ownership transfers, not left as-is on the assumption access was revoked
cleanly elsewhere:

- [ ] `JWT_SECRET` — rotating this logs out every session with an already-expired
      refresh token; users with a still-valid refresh token recover
      transparently on their next request. See
      [05-deployment-and-operations.md](05-deployment-and-operations.md)
      "Rotating secrets" before doing this.
- [ ] `STRIPE_SECRET_KEY` (and re-point `STRIPE_WEBHOOK_SECRET` at a webhook
      endpoint owned by the new Stripe account/team member, if the Stripe
      account itself changes hands)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — full-privilege, server-only; rotate from
      Supabase → Settings → API
- [ ] `FCM_SERVICE_ACCOUNT_BASE64` — generate a new service-account key in
      Firebase, revoke the old one
- [ ] `DATABASE_URL` / `SUPABASE_DIRECT_URL` — if the DB password rotates
- [ ] SMTP credentials
- [ ] Any TURN server credentials (`TURN_USERNAME`/`TURN_CREDENTIAL`), if
      using a hosted TURN provider rather than the default Google STUN

None of these require a code change — see
[05-deployment-and-operations.md](05-deployment-and-operations.md) "Rotating
secrets" for the exact procedure per key.

## What is and isn't currently provisioned

Every integration is coded and env-gated; what's actually **turned on**
(keys present in the production `.env`) is a separate question the outgoing
team needs to answer explicitly rather than assumed from the code existing.
Check each row in [../INTEGRATIONS.md](../INTEGRATIONS.md) against the actual
production environment and note here which are live vs. still unconfigured:

| Integration | Live in production? | Notes |
|---|---|---|
| Database (Supabase Postgres) | *fill in* | required — app doesn't function without it |
| Auth (`JWT_SECRET`) | *fill in* | required |
| Stripe payments | *fill in* | without it, checkout/tickets 503 for any non-zero amount |
| Supabase Storage | *fill in* | without it, uploads fail |
| Firebase push | *fill in* | without it, push silently stays off, app still works |
| Google Maps/Geocoding | *fill in* | without it, event map is blank, venues store null coords |
| WebRTC TURN | *fill in* | STUN alone works on open networks; TURN needed for strict NATs |
| SMTP email | *fill in* | without it, reset codes generate but aren't delivered |
| Sentry (app-side) | *fill in* | see the app repo's handover checklist |
| PostHog (app-side) | *fill in* | see the app repo's handover checklist |
| Redis | *fill in* | optional at single-instance scale; required before scaling to 2+ instances |

## Open question: where does this actually run?

This repo includes a PM2 config (`ecosystem.config.js`) but **no deploy
target is committed anywhere** — no Dockerfile, no platform-specific config
(Render/Railway/Fly/EC2/etc.), no infra-as-code. Find out from the outgoing
team:

- [ ] What host is production actually running on today, and who has SSH/console access to it?
- [ ] Is there a staging environment, or has every change gone straight to production?
- [ ] How does a deploy currently happen — manually, or via some script/process not in this repo?
- [ ] Is there monitoring/alerting on the host itself (disk, memory, process
      uptime) outside of what's described in
      [05-deployment-and-operations.md](05-deployment-and-operations.md)?

If the answer to any of these is "nobody knows" or "the previous engineer did
it by hand," that's the highest-priority item to resolve before the outgoing
team's access is revoked.

## Known gaps a new team is inheriting

Not hidden, not surprises — all written up in detail elsewhere, listed here
so they're not missed in a first read:

- **Commerce is single-operator, not a marketplace.** Products/sellers are
  seed/admin data; there is no seller onboarding, no product CRUD, no Stripe
  Connect payouts (money settles to the platform account), and no
  fulfillment/shipping. Becoming a multi-seller marketplace is a real
  build-out — scoped in [../DEFERRED-DECISIONS.md](../DEFERRED-DECISIONS.md) §3.
- **The "For You" feed uses a heuristic ranker, not a learned recommender**
  (engagement · recency · affinity — real, but not ML). A learned model needs
  watch-time capture the app doesn't emit yet; **product/hashtag search** is
  still missing too. [../DEFERRED-DECISIONS.md](../DEFERRED-DECISIONS.md) §4.
- **No HLS transcode ladder** and **no SFU for group calls** — both
  deliberately deferred, both costed. [../DEFERRED-DECISIONS.md](../DEFERRED-DECISIONS.md).
- **No admin UI** — the moderation API (`/admin/reports`, `/admin/orders/:id/refund`)
  is real and tested; nobody has built a console in front of it. Today it's
  driven with curl.
- **Moderation is manual** — no automated content detection, no
  rate-limiting on report submission itself, no appeals flow.
- **No error-tracking on the backend** and **no automated cleanup job** for
  expired token/reset-code rows — see [06-security.md](06-security.md) "Open
  items."
- **The app has never been run end-to-end against this backend in
  production** — per the app repo's STATUS.md, all integration testing has
  been against local dev. Budget time for contract-drift surprises the first
  time a production build talks to a production backend.

## First 30 days, suggested order

1. Get `npm run dev` + `npm test` (204 tests) green locally against your own
   Supabase (or local Postgres) instance — confirms your environment is sane
   before touching production. Note two production boot requirements (a real
   ≥32-char `JWT_SECRET` and a verified DB CA via `DB_SSL_CA_PATH`) — see
   [05-deployment-and-operations.md](05-deployment-and-operations.md)
   "Environment files".
2. Work through "Accounts and access to transfer" and "Credentials to
   rotate" above.
3. Answer "Open question: where does this actually run?" — you cannot safely
   operate this system without knowing the answer.
4. Read [06-security.md](06-security.md) in full; it's short and it's the
   highest-consequence part of this codebase to misunderstand.
5. Read [04-flows.md](04-flows.md) for the money-touching flow (checkout) and
   the auth flow — these are the two places a subtle bug has real
   consequences (a bad charge, a locked-out user base).
6. Only then start making changes.
