import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, storageBucket } from '@config/supabase';
import { ServiceUnavailableError, BadRequestError } from '@middlewares/error';

// Issues short-lived signed upload URLs so the mobile client uploads bytes
// DIRECTLY to Supabase Storage (the API server never proxies media). The client
// then sends us back the public URL when it creates the video / avatar / message.

export type UploadKind = 'video' | 'image' | 'avatar' | 'chat';

export interface SignedUpload {
  uploadUrl: string; // full URL the client PUTs the file to (token embedded)
  path: string; // storage object path
  publicUrl: string; // stable URL to persist + play back
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

const requireSupabase = (): SupabaseClient => {
  const supabase = getSupabase();
  if (!supabase) {
    throw new ServiceUnavailableError(
      'Media storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.'
    );
  }
  return supabase;
};

// Create the public bucket on first use so the operator doesn't have to click
// through the Supabase dashboard — one less manual step. Idempotent.
let bucketEnsured = false;
const ensureBucket = async (
  supabase: SupabaseClient,
  bucket: string
): Promise<void> => {
  if (bucketEnsured) return;
  const { data } = await supabase.storage.getBucket(bucket);
  if (!data) {
    await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: '200MB',
    });
  }
  bucketEnsured = true;
};

const extFor = (contentType: string): string => {
  const known = EXT_BY_CONTENT_TYPE[contentType.toLowerCase()];
  if (known) return known;
  const subtype = contentType.split('/')[1]?.split(';')[0];
  if (!subtype) throw new BadRequestError('Unrecognized content type.');
  return subtype;
};

export const createSignedUpload = async (
  userId: string,
  kind: UploadKind,
  contentType: string
): Promise<SignedUpload> => {
  const supabase = requireSupabase();
  const bucket = storageBucket();
  await ensureBucket(supabase, bucket);

  const path = `${kind}/${userId}/${randomUUID()}.${extFor(contentType)}`;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new BadRequestError(error?.message ?? 'Could not create upload URL.');
  }

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
  return { uploadUrl: data.signedUrl, path, publicUrl: pub.publicUrl };
};
