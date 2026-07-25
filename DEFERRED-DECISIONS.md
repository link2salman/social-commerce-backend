# Deferred decisions

Infrastructure choices that are **deliberately not made yet**. Each one is
understood, costed, and consciously postponed — not forgotten, and not blocked
on anything technical.

The research is written down so revisiting is a decision, not another round of
investigation. Pricing was checked **2026-07-18**; verify before committing,
vendors change terms.

---

## 1. HLS transcode ladder — DEFERRED

**Status:** not started. Videos are served as progressive MP4 straight from the
S3 bucket.

### What it would fix

Today one upload becomes one file, and every viewer downloads it at full
quality. In a vertical autoplay feed that costs more than it first appears:

- **No adaptive bitrate.** A viewer on a weak connection gets the same 1080p
  file as one on wifi, so they stall mid-scroll instead of dropping to 360p.
- **Slower first frame on every swipe.** Progressive MP4 must buffer more
  before playback than a segmented HLS rendition.
- **Bandwidth cost.** Full-size files ship to everyone regardless of need.
- **No real poster frames.** This is *why* `videoService` falls back to a random
  `picsum.photos` image — there is no frame-grab step because there is no
  transcode step. A ladder fixes the placeholder as a byproduct.
- It also blocks **baking camera filters into recordings** — the app's filters
  are preview-only (VisionCamera records the raw camera stream), so the
  `videos.filter_id` column we persist has nothing to consume it yet.

For a TikTok-style product this is the highest-value item on the list: playback
quality *is* the product experience.

### Options, costed

Scenario: ~1,000 clips/month at 30s (~500 min ingested) and ~50,000 views at
~20s watched (~16,700 min delivered).

| | Encoding | Delivery | Storage | Monthly, this scale |
|---|---|---|---|---|
| **Mux** | free on the basic quality tier | first **100,000 min/mo free** | ~$0.003/min/mo | **~$0** |
| **Cloudflare Stream** | free (ingress free too) | $1 per 1,000 min | $5 per 1,000 min stored | **~$20** |
| **Self-hosted ffmpeg** | $0 vendor | your CDN egress | your storage | ~$20–40 VPS + your time |

At ~10× this traffic the ordering inverts: Mux starts billing (roughly
$0.025/min delivered on the higher-resolution tiers) while Cloudflare stays near
$167/mo. **Mux gives the longest free runway; Cloudflare is far cheaper once
there's real volume.** Mux's tiers are resolution-based and genuinely confusing —
use their calculator rather than reasoning from list prices.

**Self-hosted is not "free."** It is a subsystem, not a feature: job queue,
worker process, retry/dead-letter handling, "processing…" status surfaced back
to the app, and storage lifecycle. Transcoding is CPU-bound, so a traffic spike
becomes a backlog with videos stuck processing. Its real argument is not cost —
it is that it's the only option that can bake camera filters in without vendor
support.

**Reliability:** Mux and Cloudflare are multi-region CDNs and this is their core
business. A self-hosted pipeline will be less reliable than either for a long
time.

### If/when this is picked up

Put it behind a provider-agnostic interface so the choice stays reversible. The
touch points are known:

- `videoService.createVideo` — currently writes the raw upload URL to `hls_url`
  and invents a poster. It would instead submit a transcode job and store the
  returned playback ID.
- A webhook receiver for transcode-complete (the Stripe webhook in `app.ts` is
  the pattern — mounted before `express.json()` for raw-body signature checks).
- A `processing` state on the video, which the app's feed must render (a clip
  isn't playable the instant it's uploaded any more — that's a real UX change,
  not just a backend one).
- `videos.hls_url` becomes accurate rather than a documented misnomer.
- `videos.filter_id` finally has a consumer.

---

## 2. SFU for group-call media — DEFERRED

**Status:** group calls ring every participant and show a roster; they carry no
media. 1:1 calls carry real WebRTC audio/video and are unaffected.

### What it would fix

Only calls with **3+ participants**. 1:1 already works peer-to-peer and costs
nothing beyond TURN relay on strict NATs. A mesh topology doesn't scale past
~3–4 participants (each client encodes and uploads a stream per peer), which is
why an SFU — one server that receives each stream and forwards it — is the
standard answer.

### Cost

[LiveKit's](https://livekit.com/pricing) free "Build" tier is 5,000 WebRTC
participant-minutes + 50GB transfer/month, no credit card, and the allowance is
a **hard cap: requests fail rather than incurring overage.** A 4-person 10-minute
call is 40 participant-minutes, so roughly 125 such calls/month free — enough to
build and validate the feature. Paid tiers start at $50/mo.

Self-hosting LiveKit removes the per-participant fee but not the cost: an SFU is
bandwidth-dominated and that bandwidth scales with participants², plus you own
the ops.

### Why it's deferred

It is the **least core feature with the highest effort**. Group video calling is
peripheral to a social commerce app, and the work lands on both sides: backend
room management and token minting, plus rewriting the app's group-call path from
direct WebRTC to the LiveKit SDK. The current state — rings, shows a roster, no
media — is a working, honestly-labelled partial.

### If/when this is picked up

- LiveKit Cloud first (free tier proves it), self-host later if economics
  demand — the client SDK is identical, so that migration isn't a rewrite.
- Token minting fits the existing JWT/session service cleanly.
- Group calls are already *recorded* in the call log, so history won't need
  revisiting.
- Decide deliberately whether 1:1 also moves onto the SFU. Keeping two code
  paths is a real maintenance cost; routing 1:1 through an SFU adds latency and
  per-minute cost to calls that are currently free.

---

## 3. Multi-seller marketplace: supply + fulfillment BUILT; payouts still deferred

**Status:** the **supply side** (seller onboarding + product CRUD) and
**fulfillment** (shipping address, ship/deliver lifecycle) are now built. Only
the **payout** side (Stripe Connect) remains deferred — held on cost/compliance.

### Supply side — built

- `POST /sellers` (become a seller) · `GET /sellers/me` · `GET /sellers/me/products`
- `POST /products` · `PATCH /products/:id` · `DELETE /products/:id` (soft-delete)
- One seller profile per user (`sellers.user_id`, unique, migration
  `20260723010000`); ownership enforced (only the owning user edits/deletes;
  platform seed products stay uneditable). Prices are dollars on the wire →
  cents in storage; images/variants managed inline (replace-on-PATCH). Covered
  by `tests/integration/seller.test.ts`.

Inventory is already enforced at checkout, so a real seller's stock is now
authoritative end-to-end.

### Still deferred, and why

1. **Payouts — Stripe Connect.** Today every PaymentIntent settles into the
   *platform's* account (`paymentService.createPaymentIntent` has no
   `transfer_data`/`application_fee_amount`). A marketplace that takes money on
   behalf of sellers legally needs **Stripe Connect**: onboard each seller as a
   connected account (Express accounts + hosted onboarding), then either
   destination charges (`transfer_data.destination` + `application_fee_amount`)
   or separate charges + transfers. This also pulls in 1099-K reporting, payout
   scheduling, and a balance/ledger surface. Event ticketing has the identical
   limitation (hosts can't receive ticket revenue) and would ride the same
   Connect integration.

### Fulfillment — BUILT (order-level)

Checkout now collects a **shipping address** (`POST /orders/intent` accepts
`shippingAddress`, stored on the order), and an order carries a **fulfillment
lifecycle** a seller drives: `unfulfilled → shipped → delivered` with a tracking
number/carrier (`orders.fulfillment_status` + `shipped_at`/`delivered_at`,
migration `20260723030000`). Sellers see their paid orders (`GET
/sellers/me/orders`) and act on them (`POST /sellers/me/orders/:id/fulfill` /
`/deliver`, authorized by "you have a product in this order"); the buyer sees
address + fulfillment on their order detail. Covered by
`tests/integration/fulfillment.test.ts`. Tracked separately from payment
`status`, so the client's payment-derived enum is unchanged.

Still open on fulfillment (not blocking): **seller management screens** in the
app (product editor + a seller-orders list with fulfill/deliver — the backend is
ready), **real carrier tracking** (today `tracking_number` is free text, no
carrier-API integration), and **per-seller split shipments** for a multi-seller
order (fulfillment is order-level in this v1).

### Why payouts still stay deferred

Payouts are a compliance-weighted, **paid** integration (Connect onboarding,
1099-K, dispute handling) and move real money. Building it halfway would be worse
than the honest current state. The technical *foundation* is already right —
server-authoritative pricing, enforced inventory, idempotent checkout, a verified
webhook, a real supply side, and now fulfillment — so payouts bolt on cleanly
when the business decides.

### Related now-real fixes (so this list stays honest)

- **Inventory is enforced.** Checkout atomically decrements `products.stock`
  under a `stock >= qty` guard; an over-quantity order 409s. (It previously
  wasn't checked at all.)
- **Refunds are reachable** via `POST /admin/orders/:id/refund` (operator
  action). Full customer-initiated returns/RMA remain out of scope.
- **Tax/shipping are configurable** (`TAX_RATE`, `SHIPPING_FLAT_CENTS`) but
  still flat — real address-based sales tax (Stripe Tax / TaxJar) is part of
  this deferral.

---

## 4. Feed ranking / discovery — RANKER + SEARCH BUILT; learned ranking still deferred

**Status:** "For You" is now a **personalized, ranked feed** (`rankingService`),
not reverse-chronological. "Following" remains reverse-chronological by design
(it's a catch-up timeline). **Search is built** (products/videos/people). Only a
*learned* recommender (and trending pages) remain deferred.

### What was built (the v1 ranker)

A transparent, env-tunable heuristic — the standard v1 every product ships
before it has the data to train a model:

```
score = engagement · recency · affinity
  engagement = log1p(weighted likes/comments/shares/saves) + 1   (dampened)
  recency    = 2 ^ (−ageHours / halfLife)
  affinity   = followBoost if the viewer follows the author,
               × seenPenalty if the viewer already engaged with it
```

It is **personalized** (follows, prior engagement, blocks), **recency-aware**,
and **cold-start-safe** (a new viewer with no graph falls back to
engagement·recency — a popularity-weighted freshness feed, never empty). Every
weight is an env var (`RANK_*`), so it's tunable without a deploy. Pagination is
stable within a session: the cursor carries an **anchor time** so recency decay
is computed identically across pages. The wire contract is unchanged — the
cursor is opaque, so the app needed no change. Covered by
`tests/integration/feed.test.ts` (engagement/recency/affinity ordering,
exclusions, cold start, stable pagination).

### What's still deferred, and why

- **A *learned* recommender.** The heuristic is a real improvement but not a
  trained model. Learning to rank needs **watch-time / impression capture**
  (how long each viewer watched, completion, re-watch) — a client event
  pipeline the app doesn't emit yet — plus a training/eval loop. That only pays
  off with live usage data. The heuristic is the honest interim, and its scoring
  seam (`rankingService.scoreVideo`) is where learned scores would slot in.
- **The candidate pool is a bounded recency window** (`RANK_WINDOW_DAYS`,
  `RANK_CANDIDATE_POOL`) scored in-app. At real scale this in-app scan is where
  a proper retrieval layer (a materialized score refreshed by a job, or a
  vector/ANN index) would replace it — deferred until traffic demands it.

**Product / video / hashtag search — BUILT.** `GET /search?type=products|videos|users&q=`
matches products (title/description), videos (caption, `#hashtag` aware), and
people, served by pg_trgm GIN indexes (migration `20260723000000`). No ML, no
paid service. Covered by `tests/integration/search.test.ts`. The remaining
discovery gap is *trending* (a job aggregating recent engagement into
sound/hashtag pages) — deferred, not blocking.

---

## Not deferred — since built

These needed no vendor decision and no spend, so they were just done (see
README → Status):

- **Notifications domain** — persisted feed, unread count, read state, emitted
  from the same places the FCM pushes fire.
- **Moderation tooling** — `/admin` report queue with resolution actions that do
  real work (soft-delete content, deactivate accounts), report **rate-limiting** +
  de-dupe, user **muting**, and an **appeal flow** (contest a suspension or a
  removed video/post; grant reverses the action). Admin-only in-app screens sit in
  front of it, gated on `is_admin`.
- **Group-call history** — `CallRecord` widened to carry a frozen participant
  roster alongside the existing 1:1 shape.
- **Posts feature (image / text / video)** — the Instagram/Twitter-style feed,
  a **parallel content stack** to videos (`posts`, `post_media`,
  `post_engagements`, `post_comments`, `post_comment_likes`) so the tested video
  pipeline is untouched. Full engagement (like/dislike, threaded comments, share,
  save), a scrollable feed behind a Posts⇄Videos toggle, a post-detail screen, an
  in-app composer, and reporting on posts + post comments. Chosen NOT to make the
  video `Engagement`/`Comment` tables polymorphic — the FK+CASCADE and 269 passing
  tests made that a poor trade for a feature addition.

## Still open, no vendor needed

- iOS support (`react-native-config`'s Xcode phase was never set up).
- A standalone **web** admin console (the moderation/appeals API is driven by
  admin-only in-app screens today).
- **Post-video autoplay-on-scroll.** Inline post videos are **tap-to-play**
  (poster + play badge, then plays with sound) — reliable inside a scrolling list.
  Muted autoplay when a post scrolls into view is a deliberate follow-up (needs
  FlashList viewability tracking + a single shared active player).
- **Product/video/hashtag search** — people-search only today (see §4).
- **Email-verification enforcement.** `email_verified` is persisted but never
  gates login or any action; enforcing it is a product/policy decision (it would
  block every seeded demo account, which is why it isn't on by default).
- **Engagement notifications** — **like notifications are now built** (a like on
  your video shows in your feed; `notification_type` gained a `like` value in
  both repos, emitted from `engagementService`, covered by tests). Still
  deferred: **mentions** (needs @-parsing), **"new video from someone you
  follow"** (a fan-out-on-write to every follower), and **"trending"** (needs an
  aggregation job).
- **Open-share-to-exact-video.** A shared link now reopens the app and records
  the share, but there is no single-video screen, so `/v/:id` lands on the feed
  rather than that clip. Needs a dedicated screen on the app side.
- **RBAC.** Moderation is a single `is_admin` boolean by design; a real role
  system is only needed if the operator surface grows.

## Sources

- [Mux pricing](https://www.mux.com/pricing) · [calculator](https://www.mux.com/pricing/calculator) · [video pricing detail](https://www.mux.com/docs/pricing/video)
- [Cloudflare Stream pricing](https://developers.cloudflare.com/stream/pricing/)
- [LiveKit pricing](https://livekit.com/pricing) · [quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
