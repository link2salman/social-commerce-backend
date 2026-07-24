import { randomUUID } from 'crypto';
import { Op, fn, col, where } from 'sequelize';
import { sequelize } from '@config/db';
import { NotFoundError } from '@middlewares/error';
import Video from '@models/feed/Video';
import VideoProduct from '@models/commerce/VideoProduct';
import Block from '@models/social/Block';
import { hydrateVideos } from '@services/feedService';
import type { VideoJSON } from '@serializers/videoSerializer';

export interface CreateVideoInput {
  videoUrl: string;
  thumbnailUrl: string | null;
  caption: string;
  durationMs: number;
  soundName: string | null;
  filterId: string | null;
  productIds: string[];
}

// Publish a video the user recorded/uploaded. The media already lives in storage
// (the client uploaded it via a signed URL); we just persist the row + any
// shoppable product tags, then hydrate it into the exact feed card shape so the
// app can prepend it to the feed without a refetch. No transcode pipeline — the
// stored MP4 is played directly (react-native-video handles progressive MP4).
export const createVideo = async (
  userId: string,
  input: CreateVideoInput
): Promise<VideoJSON> => {
  const videoId = randomUUID();
  // PLACEHOLDER POSTER: when the client didn't upload its own thumbnail we ship
  // a RANDOM STOCK PHOTO from picsum.photos — seeded by video id so it stays
  // stable across requests, but it is an unrelated image, not a frame of this
  // video. There is no frame-grab step because there is no transcode pipeline.
  // Replacing it: extract a real frame on upload (an ffmpeg worker, or the
  // poster URL from Mux / Cloudflare Stream if the HLS ladder lands first) and
  // write that URL here instead — see INTEGRATIONS.md → "What still needs a
  // real service".
  const thumbnail =
    input.thumbnailUrl ?? `https://picsum.photos/seed/${videoId}/800/1400`;

  const video = await sequelize.transaction(async transaction => {
    const created = await Video.create(
      {
        video_id: videoId,
        author_id: userId,
        // `hls_url` is a MISNOMER: it stores whatever URL the client uploaded,
        // which today is a raw progressive MP4 in storage — never an HLS
        // manifest (nothing transcodes one). The name is kept deliberately:
        // renaming the column is a migration AND a break of the app's `hlsUrl`
        // wire field, which the client's Zod schema pins. If an HLS ladder is
        // ever added, this is where the manifest URL would go and the name
        // becomes true; until then, read it as "playback URL".
        hls_url: input.videoUrl,
        thumbnail_url: thumbnail,
        caption: input.caption,
        duration_ms: input.durationMs,
        sound_name: input.soundName,
        // RECORDED INTENT, NOT AN APPLIED EFFECT — and nothing reads it back
        // yet. The app's camera filters are PREVIEW-ONLY: VisionCamera records
        // the unfiltered sensor stream, so the uploaded file has no filter
        // baked in, and the app's VideoSchema does not expect a `filterId` on
        // the response (so the serializer deliberately omits it).
        //
        // It is stored because the alternative is worse: dropping it makes the
        // creator's choice unrecoverable the moment the clip is published. A
        // future transcode step (the ffmpeg/Mux worker that would also replace
        // the placeholder poster above) is the thing that would actually apply
        // it — and it can only do that if the selection survived the upload.
        //
        // So: an intentionally unconsumed column, not a forgotten one. Don't
        // delete it as dead weight without also deleting the app's send site
        // (features/feed/api/feedApi.ts → CreateVideoInput.filterId).
        filter_id: input.filterId,
      },
      { transaction }
    );
    if (input.productIds.length > 0) {
      await VideoProduct.bulkCreate(
        input.productIds.map((product_id, position) => ({
          video_id: videoId,
          product_id,
          position,
        })),
        { transaction, ignoreDuplicates: true }
      );
    }
    return created;
  });

  const [json] = await hydrateVideos([video], userId);
  return json!;
};

// Video / hashtag discovery search — case-insensitive substring over caption,
// served by the pg_trgm caption index. A leading '#' in the query is stripped so
// "#travel" and "travel" both match a caption that wrote it either way. Excludes
// authors the viewer blocked; newest-first, capped. Returns the feed-card shape
// (hydrated for the viewer) so results render exactly like a feed item.
export const searchVideos = async (
  viewerId: string,
  query: string
): Promise<{ items: VideoJSON[] }> => {
  const q = query.trim().replace(/^#+/, '').toLowerCase();
  if (!q) return { items: [] };

  const blocks = await Block.findAll({
    where: { blocker_id: viewerId },
    attributes: ['blocked_id'],
  });
  const blocked = blocks.map(b => b.blocked_id);

  const rows = await Video.findAll({
    where: {
      ...(blocked.length ? { author_id: { [Op.notIn]: blocked } } : {}),
      [Op.and]: [where(fn('lower', col('caption')), { [Op.like]: `%${q}%` })],
    },
    order: [
      ['created_at', 'DESC'],
      ['video_id', 'DESC'],
    ],
    limit: 20,
  });

  const items = await hydrateVideos(rows, viewerId);
  return { items };
};

// Record a share. share_count is a denormalized counter on the video (the feed's
// hot read path never COUNTs), so bump it atomically and return the new value
// for the client's optimistic UI to reconcile against. Sharing a removed video
// 404s (findByPk respects the paranoid soft-delete scope).
export const recordShare = async (
  videoId: string
): Promise<{ shareCount: number }> => {
  const video = await Video.findByPk(videoId);
  if (!video) throw new NotFoundError('Video');
  await video.increment('share_count', { by: 1 });
  await video.reload();
  return { shareCount: video.share_count };
};
