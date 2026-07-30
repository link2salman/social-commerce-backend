import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getS3,
  s3Bucket,
  s3PublicBaseUrl,
  s3UploadUrlTtlSeconds,
} from '@config/s3';
import { ServiceUnavailableError, BadRequestError } from '@middlewares/error';
import logger from '@utils/logger';

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

// ─────────────────────────────────────────────────────────────────────────────
// Server-side object access. Only the media pipeline uses these: the request
// path still never proxies bytes (that is what the presigned PUT above is for),
// but the transcode worker has to read an original and write its outputs, and it
// is not a browser holding a signed URL.
// ─────────────────────────────────────────────────────────────────────────────

/** One year, immutable — see CACHE_CONTROL_IMMUTABLE. */
const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Media objects are content-addressed in practice: every key contains a fresh
 * UUID, so a given URL's bytes never change. That makes them safely immutable,
 * which is what lets a CDN edge (or the device's own HTTP cache) keep them
 * without ever revalidating. Objects written before this existed have NO
 * Cache-Control at all — a CDN in front of the bucket would have to guess.
 *
 * Note this only covers what the *server* writes. The client's presigned PUT
 * still stores its object without a cache header; fixing that means signing
 * `Cache-Control` into the URL and having the app echo it, exactly like
 * Content-Type above. Worth doing, but it is a two-sided contract change — and
 * for videos it matters much less now, because the object every viewer actually
 * streams is the transcode written here, not the client's upload.
 */
export const CACHE_CONTROL_IMMUTABLE = `public, max-age=${ONE_YEAR_SECONDS}, immutable`;

/**
 * Turn a stored public URL back into its bucket key. The URL was minted as
 * `${s3PublicBaseUrl()}/${key}`, so this is the exact inverse — and it throws
 * rather than guessing when the base doesn't match, because a mismatch means the
 * row predates a change of S3_PUBLIC_BASE_URL (or points at a foreign host like
 * the seeded sample clips) and the caller must not treat some truncated string
 * as a key.
 */
export const keyFromPublicUrl = (url: string): string => {
  const base = `${s3PublicBaseUrl()}/`;
  if (!url.startsWith(base)) {
    throw new BadRequestError(`Not an object in this bucket: ${url}`);
  }
  return url.slice(base.length);
};

/** Read an object into memory. Only used for files we transcode (tens of MB). */
export const getObjectBytes = async (key: string): Promise<Buffer> => {
  const s3 = requireS3();
  const res = await s3.send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }));
  if (!(res.Body instanceof Readable)) {
    throw new ServiceUnavailableError(`Unreadable object body for ${key}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
};

/**
 * Write an object and return its stable public URL. `siblingOf` places the new
 * key in the same folder as an existing one so a clip's original, its transcode
 * and its poster stay together under `video/<user-id>/`, which is what makes the
 * bucket browsable and a per-user retention rule expressible.
 */
export const putObject = async ({
  siblingOf,
  suffix,
  body,
  contentType,
}: {
  siblingOf: string;
  suffix: string;
  body: Buffer;
  contentType: string;
}): Promise<{ path: string; public_url: string }> => {
  const s3 = requireS3();
  const folder = siblingOf.includes('/') ? siblingOf.slice(0, siblingOf.lastIndexOf('/')) : '';
  const path = `${folder ? `${folder}/` : ''}${randomUUID()}${suffix}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: path,
      Body: body,
      ContentType: contentType,
      CacheControl: CACHE_CONTROL_IMMUTABLE,
    })
  );

  return { path, public_url: `${s3PublicBaseUrl()}/${path}` };
};

export interface StoredObject {
  key: string;
  size: number;
  /** Null when S3 omits it — the retention sweep treats that as "cannot age". */
  lastModified: Date | null;
}

/**
 * Every object in the bucket, following pagination to the end.
 *
 * Only the retention sweep needs this, and it needs *all* of it: a partial
 * listing would make the objects it never saw look like they do not exist, which
 * is harmless here (they simply are not swept) but would be actively wrong for
 * any caller reasoning about absence. Keys and sizes only — no bodies — so the
 * memory cost is a few hundred bytes per object.
 */
export const listAllObjects = async (): Promise<StoredObject[]> => {
  const s3 = requireS3();
  const bucket = s3Bucket();
  const out: StoredObject[] = [];
  let token: string | undefined;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })
    );
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue;
      out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? null });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return out;
};

/**
 * Delete objects by key, in the 1000-per-request batches the API allows.
 *
 * @returns how many were actually deleted — failures are logged and subtracted
 * rather than thrown, because a sweep that aborts halfway through would leave the
 * caller unable to say what it had already removed.
 */
export const deleteObjects = async (keys: string[]): Promise<number> => {
  if (keys.length === 0) return 0;
  const s3 = requireS3();
  const bucket = s3Bucket();
  let deleted = 0;

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
      })
    );
    const errors = res.Errors ?? [];
    for (const e of errors) logger.error({ key: e.Key, code: e.Code }, 'object delete failed');
    deleted += batch.length - errors.length;
  }

  return deleted;
};
