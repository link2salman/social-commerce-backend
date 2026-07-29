import { randomUUID } from 'crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getS3,
  s3Bucket,
  s3PublicBaseUrl,
  s3UploadUrlTtlSeconds,
} from '@config/s3';
import { ServiceUnavailableError, BadRequestError } from '@middlewares/error';

// Issues short-lived presigned S3 PUT URLs so the mobile client uploads bytes
// DIRECTLY to the bucket (the API server never proxies media). The client then
// sends us back the public URL when it creates the video / avatar / message.
//
// We sign Content-Type into the URL (`signableHeaders`), which the presigner does
// NOT do by default — without it the client picks the stored Content-Type freely,
// and an authenticated user could park `text/html` on a public bucket. Signed
// means S3 rejects any mismatch with 403, so the type WE validated is the type
// that ends up stored (and served back on playback). The client must therefore
// echo the exact same Content-Type on its PUT.
//
// No ACL is signed: modern buckets run with ACLs disabled (bucket-owner
// enforced), so public read comes from a bucket policy or CDN, not per-object.

export type UploadKind = 'video' | 'image' | 'avatar' | 'chat';

export interface SignedUpload {
  upload_url: string; // presigned URL the client PUTs the file to
  path: string; // object key inside the bucket
  public_url: string; // stable URL to persist + play back
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

const requireS3 = (): S3Client => {
  const s3 = getS3();
  if (!s3) {
    throw new ServiceUnavailableError(
      'Media storage is not configured. Set S3_BUCKET (and AWS credentials) on the server.'
    );
  }
  return s3;
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
  const s3 = requireS3();
  const bucket = s3Bucket();
  const path = `${kind}/${userId}/${randomUUID()}.${extFor(contentType)}`;

  const upload_url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      ContentType: contentType,
    }),
    {
      expiresIn: s3UploadUrlTtlSeconds(),
      signableHeaders: new Set(['content-type']),
    }
  );

  return { upload_url, path, public_url: `${s3PublicBaseUrl()}/${path}` };
};
