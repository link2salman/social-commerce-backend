import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';
import Video from '@models/feed/Video';
import PostMedia from '@models/feed/PostMedia';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '@middlewares/error';
import { getObjectBytes, keyFromPublicUrl, putObject } from '@services/storageService';
import { numberEnv } from '@utils/env';
import logger from '@utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Clip transcode: the piece that was missing.
//
// Nothing used to touch an uploaded clip. `videos.hls_url` held whatever the
// phone recorded, and that exact file was what every viewer streamed — a
// 6-second capture measured 12.7 MB (≈16.5 Mbps), with its `moov` atom at the
// END of the file because that is what Android's MediaMuxer writes. Two separate
// costs, both paid on every single view:
//
//   * Size. ~16 Mbps for a clip watched in a phone-sized card is 5-10x what it
//     needs. It is the author's upload time and every viewer's first frame.
//   * `moov` at the end. That atom is the index; without it the decoder cannot
//     start. A player fetching a progressive MP4 has to range-request the tail
//     of the file, read the index, then come back for the media — a whole extra
//     round trip before the first frame, on top of the bytes.
//
// So this does two things and both matter: re-encode with a bounded bitrate, and
// write `-movflags +faststart` so `moov` leads. A real poster frame falls out of
// the same pass, which retires the placeholder (videoService used to point
// `thumbnail_url` at a RANDOM picsum photo — an unrelated image, which is why a
// still-buffering card looked like someone else's video).
//
// Deliberately a single output, not an ABR ladder. One bounded rendition gets
// most of the win for a fraction of the CPU, storage and failure surface, and
// HLS only starts paying when you need mid-stream adaptation. The ladder is the
// next step if playback data says it is needed; the shape here (a job kind, a
// worker, outputs written next to the original) is what it would extend.
//
// The original is NOT deleted. It is the only copy of what the user shot, this
// is the first run of a brand-new encoder path, and a bad ffmpeg flag would
// otherwise be unrecoverable. Retention is a follow-up (see README gaps).
// ─────────────────────────────────────────────────────────────────────────────

const exec = promisify(execFile);

// Long edge / short edge of the box the video is fitted into, and the ceiling on
// bitrate. Env-tunable like the ranking weights, because the right numbers are a
// product call about quality-vs-data, not a constant of nature.
const MAX_LONG_EDGE = numberEnv('TRANSCODE_MAX_LONG_EDGE', 1920);
const MAX_SHORT_EDGE = numberEnv('TRANSCODE_MAX_SHORT_EDGE', 1080);
const MAX_BITRATE_K = numberEnv('TRANSCODE_MAX_BITRATE_K', 2500);
const CRF = numberEnv('TRANSCODE_CRF', 26);
// A clip is short; anything slower than this is a hung ffmpeg, not a slow one.
const TIMEOUT_MS = numberEnv('TRANSCODE_TIMEOUT_MS', 300_000);

/**
 * Fit inside MAX_LONG_EDGE × MAX_SHORT_EDGE **without ever upscaling**, honouring
 * whichever way round the clip is.
 *
 * `scale` on its own will happily enlarge a 720p capture to fill the box, which
 * costs bitrate and invents no detail — hence `min(iw, …)`: when the input is
 * already smaller than the target the box collapses to the input's own size and
 * `force_original_aspect_ratio=decrease` leaves it alone. The `gte(iw,ih)` picks
 * which edge is which so a landscape clip is bounded 1920 wide, and a portrait
 * one 1920 tall, rather than both being squeezed into a square.
 *
 * `force_divisible_by=2` keeps both dimensions even, which yuv420p requires (an
 * odd dimension is a hard encoder error, not a rounding warning).
 */
const scaleFilter = (): string =>
  [
    `scale=`,
    `w='if(gte(iw,ih),min(iw,${MAX_LONG_EDGE}),min(iw,${MAX_SHORT_EDGE}))'`,
    `:h='if(gte(iw,ih),min(ih,${MAX_SHORT_EDGE}),min(ih,${MAX_LONG_EDGE}))'`,
    `:force_original_aspect_ratio=decrease`,
    `:force_divisible_by=2`,
  ].join('');

/**
 * No ffprobe. The only thing a probe was wanted for is where to grab the poster
 * frame, and `videos.duration_ms` already holds the clip's length — the client
 * measures it and the validator enforces a positive integer, so the row is a
 * cheaper and equally good source than shelling out to read the file we are about
 * to hand to ffmpeg anyway. Dropping it also drops a second binary to ship (and
 * `ffprobe-static`'s macOS-arm64 build turned out to be broken: EBADARCH).
 *
 * ffmpeg itself is `ffmpeg-static`, a prebuilt binary pulled in as a normal
 * dependency, so a deploy needs no `apt-get install ffmpeg` step and cannot drift
 * from what was tested. A missing path here means an install that skipped the
 * postinstall download, or an unsupported platform — a deploy problem, not a
 * per-clip one, hence 503 rather than a per-job failure.
 */
const requireFfmpeg = (): string => {
  if (!ffmpegPath) {
    throw new ServiceUnavailableError(
      'Transcoding is unavailable: the bundled ffmpeg binary is missing.'
    );
  }
  return ffmpegPath;
};

/**
 * Re-encode to a bounded, faststart MP4.
 *
 * CRF with a bitrate ceiling rather than a fixed bitrate: quality-targeted so a
 * static shot costs little, capped so a confetti-cannon shot can't blow the
 * budget. `-preset veryfast` because this shares a small VPS with the API — the
 * slower presets buy a few percent of size for several times the CPU.
 *
 * No `-c:a` guard is needed for a silent clip: the app records without audio when
 * the mic is refused, and ffmpeg simply produces no audio stream rather than
 * failing.
 */
const encodeVideo = async (input: string, output: string): Promise<void> => {
  const ffmpeg = requireFfmpeg();
  await exec(
    ffmpeg,
    [
      '-y',
      '-i', input,
      '-vf', scaleFilter(),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-profile:v', 'high',
      '-crf', String(CRF),
      '-maxrate', `${MAX_BITRATE_K}k`,
      '-bufsize', `${MAX_BITRATE_K * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      // The whole point: index first, so playback can start on the first bytes.
      '-movflags', '+faststart',
      output,
    ],
    { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 8 }
  );
};

/**
 * Grab a real frame for the poster.
 *
 * Seeks 1s in, or to the midpoint of anything shorter — frame 0 of a phone
 * recording is very often the blur of the hand that pressed record. `-ss` before
 * `-i` so ffmpeg seeks rather than decoding up to the point.
 *
 * `durationMs` is nullable because a post's video attachment is not required to
 * report one (the client sends it, and `post_media.duration_ms` allows null).
 * With no duration we cannot know whether 1s is past the end, so we seek to 0 —
 * a first frame beats a failed seek producing no poster at all.
 */
const extractPoster = async (
  input: string,
  output: string,
  durationMs: number | null
): Promise<void> => {
  const ffmpeg = requireFfmpeg();
  const at = durationMs === null ? 0 : Math.min(1, durationMs / 2000);
  await exec(
    ffmpeg,
    [
      '-y',
      '-ss', at.toFixed(3),
      '-i', input,
      '-frames:v', '1',
      '-vf', scaleFilter(),
      '-q:v', '4',
      output,
    ],
    { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 8 }
  );
};

export interface TranscodeOutcome {
  video_id: string;
  original_bytes: number;
  transcoded_bytes: number;
  playback_url: string;
  poster_url: string;
}

/** What one encode produced, before any row is repointed at it. */
interface EncodedMedia {
  original_bytes: number;
  transcoded_bytes: number;
  playback_url: string;
  poster_url: string;
}

/**
 * Download one stored clip, re-encode it, extract a poster, and put both back in
 * the bucket beside the original. Returns the new URLs WITHOUT writing to any
 * row — the caller owns that, because a feed video and a post's media attachment
 * store their URLs on different tables under different column names.
 *
 * Shared by both job kinds so there is one encoder configuration, one temp-dir
 * discipline, and one place where the original is deliberately kept.
 *
 * `durationMs` only steers where the poster frame is grabbed from; a null (a post
 * video whose client never reported a duration) just falls back to the default
 * seek in `extractPoster`.
 */
const encodeStoredClip = async (
  sourceUrl: string,
  durationMs: number | null
): Promise<EncodedMedia> => {
  const sourceKey = keyFromPublicUrl(sourceUrl);
  const dir = await mkdtemp(join(tmpdir(), 'iovibe-transcode-'));

  try {
    const inputPath = join(dir, 'in.mp4');
    const videoOut = join(dir, 'out.mp4');
    const posterOut = join(dir, 'poster.jpg');

    const original = await getObjectBytes(sourceKey);
    await writeFile(inputPath, original);

    await encodeVideo(inputPath, videoOut);
    await extractPoster(inputPath, posterOut, durationMs);

    const [encoded, poster] = await Promise.all([readFile(videoOut), readFile(posterOut)]);

    const [uploadedVideo, uploadedPoster] = await Promise.all([
      putObject({ siblingOf: sourceKey, suffix: '.mp4', body: encoded, contentType: 'video/mp4' }),
      putObject({ siblingOf: sourceKey, suffix: '.jpg', body: poster, contentType: 'image/jpeg' }),
    ]);

    return {
      original_bytes: original.byteLength,
      transcoded_bytes: encoded.byteLength,
      playback_url: uploadedVideo.public_url,
      poster_url: uploadedPoster.public_url,
    };
  } finally {
    // Temp files are tens of MB each; a leak here fills the disk in a day.
    await rm(dir, { recursive: true, force: true });
  }
};

export interface PostMediaTranscodeOutcome extends EncodedMedia {
  post_media_id: string;
}

/**
 * Transcode one video attached to a post and repoint its row.
 *
 * The post equivalent of `transcodeVideo`. Until this existed, `POST /posts` kept
 * whatever the client uploaded and paired it with a random picsum photo as the
 * poster — the same stopgap feed videos had before the queue landed.
 *
 * Non-video attachments are not queued at all (see postService), so reaching here
 * with an image is a programming error rather than a retriable condition, and it
 * fails permanently instead of burning the retry budget.
 */
export const transcodePostMedia = async (
  postMediaId: string
): Promise<PostMediaTranscodeOutcome> => {
  const media = await PostMedia.findByPk(postMediaId);
  if (!media) throw new NotFoundError('PostMedia');
  if (media.media_type !== 'video') {
    throw new BadRequestError(`post_media ${postMediaId} is not a video`);
  }

  const sourceUrl = media.url;
  const encoded = await encodeStoredClip(sourceUrl, media.duration_ms);

  // One UPDATE, so a reader never sees the new poster against the old file.
  // `source_url` keeps the original referenced — see the note in transcodeVideo.
  await media.update({
    url: encoded.playback_url,
    thumbnail_url: encoded.poster_url,
    ...(media.source_url === null ? { source_url: sourceUrl } : {}),
  });

  const outcome: PostMediaTranscodeOutcome = { post_media_id: postMediaId, ...encoded };
  logger.info(
    {
      ...outcome,
      saved_percent: Math.round((1 - encoded.transcoded_bytes / encoded.original_bytes) * 100),
    },
    'post media transcoded'
  );
  return outcome;
};

/**
 * Transcode one published clip and repoint its row at the results.
 *
 * Idempotent in the way that matters: it reads the CURRENT `hls_url`, so a second
 * run re-encodes the already-transcoded file (wasteful, harmless) rather than
 * corrupting anything — and the live-subject unique index on `media_jobs` is what
 * stops that from happening in the first place.
 *
 * A clip whose media lives outside our bucket — the seeded sample clips point at
 * Apple's and Google's demo CDNs — is skipped by `keyFromPublicUrl` throwing,
 * which the caller records as a permanent failure. That is correct: there is
 * nothing to transcode and retrying won't change it.
 */
export const transcodeVideo = async (videoId: string): Promise<TranscodeOutcome> => {
  const video = await Video.findByPk(videoId);
  if (!video) throw new NotFoundError('Video');

  const sourceUrl = video.hls_url;
  const encoded = await encodeStoredClip(sourceUrl, video.duration_ms);

  // One UPDATE, so a reader never sees the new poster against the old file.
  //
  // `source_url` keeps the pre-transcode original REFERENCED. We deliberately do
  // not delete it (it is the only copy of what the user shot), and without this
  // it would be referenced by nothing — indistinguishable from a true orphan, so
  // the retention sweep would eventually destroy it. Recording it here is what
  // keeps "reclaim the originals" a deliberate decision instead of a side effect
  // of running a cleanup. Only set on the first transcode, so a re-run cannot
  // overwrite the true original with an intermediate rendition.
  await video.update({
    hls_url: encoded.playback_url,
    thumbnail_url: encoded.poster_url,
    ...(video.source_url === null ? { source_url: sourceUrl } : {}),
  });

  const outcome: TranscodeOutcome = { video_id: videoId, ...encoded };
  logger.info(
    {
      ...outcome,
      saved_percent: Math.round((1 - encoded.transcoded_bytes / encoded.original_bytes) * 100),
    },
    'clip transcoded'
  );
  return outcome;
};
