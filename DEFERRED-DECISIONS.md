# Deferred decisions

Infrastructure choices that are **deliberately not made yet**. Each one is
understood, costed, and consciously postponed — not forgotten, and not blocked
on anything technical.

The research is written down so revisiting is a decision, not another round of
investigation. Pricing was checked **2026-07-18**; verify before committing,
vendors change terms.

---

## 1. HLS transcode ladder — DEFERRED

**Status:** not started. Videos are served as progressive MP4 straight from
Supabase Storage.

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

## Not deferred — since built

These needed no vendor decision and no spend, so they were just done (see
README → Status):

- **Notifications domain** — persisted feed, unread count, read state, emitted
  from the same places the FCM pushes fire.
- **Moderation tooling** — `/admin` report queue with resolution actions that do
  real work (soft-delete content, deactivate accounts).
- **Group-call history** — `CallRecord` widened to carry a frozen participant
  roster alongside the existing 1:1 shape.

## Still open, no vendor needed

- iOS support (`react-native-config`'s Xcode phase was never set up).
- An admin console UI in front of the moderation API.
- **The app has never been run end-to-end against this backend.** Still the
  single highest-value unblocked task, and the most likely place to find
  contract drift.

## Sources

- [Mux pricing](https://www.mux.com/pricing) · [calculator](https://www.mux.com/pricing/calculator) · [video pricing detail](https://www.mux.com/docs/pricing/video)
- [Cloudflare Stream pricing](https://developers.cloudflare.com/stream/pricing/)
- [LiveKit pricing](https://livekit.com/pricing) · [quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
