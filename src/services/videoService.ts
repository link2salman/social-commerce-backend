import { randomUUID } from 'crypto';
import { sequelize } from '@config/db';
import Video from '@models/feed/Video';
import VideoProduct from '@models/commerce/VideoProduct';
import { hydrateVideos } from '@services/feedService';
import type { VideoJSON } from '@serializers/videoSerializer';

export interface CreateVideoInput {
  videoUrl: string;
  thumbnailUrl: string | null;
  caption: string;
  durationMs: number;
  soundName: string | null;
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
  // No frame-grab pipeline yet: fall back to a deterministic poster if the client
  // didn't upload a thumbnail. Documented placeholder, mirrors events' cover_url.
  const thumbnail =
    input.thumbnailUrl ?? `https://picsum.photos/seed/${videoId}/800/1400`;

  const video = await sequelize.transaction(async transaction => {
    const created = await Video.create(
      {
        video_id: videoId,
        author_id: userId,
        hls_url: input.videoUrl,
        thumbnail_url: thumbnail,
        caption: input.caption,
        duration_ms: input.durationMs,
        sound_name: input.soundName,
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
