import { numberEnv } from '@utils/env';

/**
 * Media ceilings — the single source shared by the upload validator, the
 * presigner in `services/storageService.ts`, and the video/post validators.
 *
 * Every number here is a PRODUCT call about quality-vs-cost, not a constant of
 * nature, so each one is `numberEnv`-tunable exactly like the transcode targets
 * in `services/transcodeService.ts`. Changing one is an env edit and a restart,
 * not a deploy. The defaults are documented in every `.env.*` template.
 *
 * Why any of this exists: a presigned upload with no bound is an open door onto
 * a real AWS account. `POST /uploads/sign` is authenticated but otherwise
 * unmetered, so without a ceiling one account can park arbitrarily many
 * arbitrarily large objects in the bucket — a billing exposure, and (because the
 * transcode worker pulls every uploaded original onto a small shared VPS before
 * running ffmpeg on it) a disk/memory exposure on the worker too.
 */

// ── Kinds ───────────────────────────────────────────────────────────────────
// The storage path prefix an upload lands under: `${kind}/${userId}/${uuid}.ext`.
export const UPLOAD_KINDS = ['video', 'image', 'avatar', 'chat'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

// ── Content types ───────────────────────────────────────────────────────────
// The extension each accepted type is stored under. This map is also the
// allowlist: a type that is not a key here cannot be signed at all, which
// retires the old behaviour of falling back to the MIME *subtype* as the file
// extension — that accepted literally any `foo/bar` string and wrote a
// `.bar` object into a public bucket.
const VIDEO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  // iOS hands back QuickTime when on-device compression is skipped or fails
  // (see the app's core/media/compress.ts — a failed compression deliberately
  // falls through to the ORIGINAL bytes rather than failing the post).
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // Same reason as QuickTime above: an uncompressed iOS pick is HEIC.
  'image/heic': 'heic',
};

export const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  ...VIDEO_EXT,
  ...IMAGE_EXT,
};

/**
 * Which content types each kind may carry. Per-kind, not a flat list, so an
 * `avatar` cannot be a 150 MB video parked in the avatars folder — the kind
 * picks both the path prefix and the size ceiling, and both would be wrong.
 *
 * The app only ever sends `video/mp4`, `image/jpeg` and `image/png` after its
 * compression pass; the extra entries cover the pass-through cases that pass
 * deliberately fails open to.
 */
export const ALLOWED_CONTENT_TYPES: Record<UploadKind, readonly string[]> = {
  video: Object.keys(VIDEO_EXT),
  image: Object.keys(IMAGE_EXT),
  avatar: Object.keys(IMAGE_EXT),
  chat: Object.keys(IMAGE_EXT),
};

// ── Size ceilings ───────────────────────────────────────────────────────────
const MB = 1024 * 1024;

/**
 * Maximum bytes a signed upload may carry, per kind.
 *
 *  * **video — 150 MB.** The app compresses to 1080p @ 2.5 Mbps before signing,
 *    so a 60-second clip normally arrives at ~20 MB. But compression is
 *    best-effort by design: when it fails the app uploads the ORIGINAL, and a
 *    60-second 1080p capture off a phone camera is ~16.5 Mbps ≈ 124 MB (a real
 *    measurement — see the transcodeService header). 150 MB clears that with
 *    room to spare and still bounds what the worker has to buffer.
 *  * **image — 25 MB.** Compressed post images land under 1 MB; 25 MB covers an
 *    uncompressed 12 MP PNG screenshot, the largest thing a picker realistically
 *    hands over.
 *  * **avatar — 8 MB.** Displayed at ~200 px. Even an uncompressed phone photo
 *    fits, and there is no reason for an avatar to be the size of a post.
 *  * **chat — 15 MB.** Same content as `image`, but chat is the highest-volume
 *    write path in the app, so it gets the tighter bound.
 */
export const MAX_UPLOAD_BYTES: Record<UploadKind, number> = {
  video: numberEnv('UPLOAD_MAX_VIDEO_MB', 150) * MB,
  image: numberEnv('UPLOAD_MAX_IMAGE_MB', 25) * MB,
  avatar: numberEnv('UPLOAD_MAX_AVATAR_MB', 8) * MB,
  chat: numberEnv('UPLOAD_MAX_CHAT_MB', 15) * MB,
};

// ── Duration ceiling ────────────────────────────────────────────────────────
/**
 * Longest clip that may be published, in milliseconds — enforced on both
 * `POST /videos` and the video attachments of `POST /posts`.
 *
 * The app caps recording at 60 s, so 90 s is that plus 50% headroom. The
 * headroom is deliberate and covers three things: a recorder that overshoots its
 * own stop by a few hundred milliseconds, a clip picked from the gallery rather
 * than recorded, and a product decision to lengthen the cap — which should be an
 * env edit here, not a backend deploy that has to land before the app's.
 *
 * The server is the durable enforcement point: a client-side cap is a UI
 * courtesy, and `POST /videos` takes `duration_ms` from the client anyway.
 */
export const MAX_VIDEO_DURATION_MS = numberEnv('VIDEO_MAX_DURATION_MS', 90_000);
