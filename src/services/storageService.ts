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
import { ERROR_CODES } from '@constants/errorCodes';
import {
  ALLOWED_CONTENT_TYPES,
  EXT_BY_CONTENT_TYPE,
  MAX_UPLOAD_BYTES,
  type UploadKind,
} from '@constants/media';
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
//
// SIZE is signed the same way, and it is the only thing that actually bounds an
// upload — see the long note on createSignedUpload below.

export type { UploadKind };

export interface SignedUpload {
  upload_url: string; // presigned URL the client PUTs the file to
  path: string; // object key inside the bucket
  public_url: string; // stable URL to persist + play back
}

const requireS3 = (): S3Client => {
  const s3 = getS3();
  if (!s3) {
    throw new ServiceUnavailableError(
      'Media storage is not configured. Set S3_BUCKET (and AWS credentials) on the server.'
    );
  }
  return s3;
};

/**
 * The stored extension for an accepted content type.
 *
 * Allowlist-only: an unknown type throws rather than falling back to the MIME
 * subtype, which used to let any `foo/bar` string name the object's extension.
 * `assertUploadAllowed` normally rejects first — this is the backstop that keeps
 * the map and the allowlist unable to drift apart.
 */
const extFor = (contentType: string): string => {
  const known = EXT_BY_CONTENT_TYPE[contentType.toLowerCase()];
  if (!known) {
    throw new BadRequestError(
      `Unsupported content type: ${contentType}`,
      ERROR_CODES.UNSUPPORTED_MEDIA_TYPE
    );
  }
  return known;
};

/** Human-readable megabytes for an error message ("up to 150 MB"). */
const asMb = (bytes: number): string =>
  `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

/**
 * The business rules a sign request has to satisfy, before we touch S3 at all.
 *
 * Deliberately ahead of `requireS3()`: a request that is wrong is a 400 whether
 * or not storage happens to be configured, which is the same ordering the body
 * validator already has relative to the 503 gate (see the contract suite).
 */
const assertUploadAllowed = (
  kind: UploadKind,
  contentType: string,
  contentLength: number
): void => {
  const allowed = ALLOWED_CONTENT_TYPES[kind];
  if (!allowed.includes(contentType.toLowerCase())) {
    throw new BadRequestError(
      `A ${kind} upload must be one of: ${allowed.join(', ')} (got ${contentType})`,
      ERROR_CODES.UNSUPPORTED_MEDIA_TYPE
    );
  }

  const max = MAX_UPLOAD_BYTES[kind];
  if (contentLength > max) {
    throw new BadRequestError(
      `That ${kind} is too large (${asMb(contentLength)}). The limit is ${asMb(max)}.`,
      ERROR_CODES.UPLOAD_TOO_LARGE
    );
  }
};

/**
 * Issue a presigned PUT that is bounded in size, type and lifetime.
 *
 * ## Why the client must declare `content_length`
 *
 * A presigned **PUT** URL has no notion of a size *range*. The only lever SigV4
 * gives us is which headers are covered by the signature: a header we sign is a
 * header S3 requires the client to send with exactly the signed value, or the
 * PUT is rejected 403 SignatureDoesNotMatch before a byte of body is stored.
 * `content-length` is signable (it is not in the SDK's ALWAYS_UNSIGNABLE_HEADERS
 * list), and putting `ContentLength` on the command emits it — so the SignedHeaders
 * of the URL we mint read `content-length;content-type;host`.
 *
 * That is exact-match enforcement, not a ceiling, and it is why the size has to
 * come from the client at sign time: we check the declared size against this
 * kind's ceiling here, then bake it into the signature so the URL is only good
 * for a file of precisely that size. Lying about it does not help — the bytes
 * and the declaration have to agree or S3 refuses the upload.
 *
 * A `content-length-range` *policy* condition, which would be a true ceiling and
 * would not need the exact number, only exists for presigned **POST** — a
 * different wire shape (multipart/form-data with policy fields) that the client
 * does not speak. So the choice was: change the client's request by one field, or
 * change how it uploads entirely. The field won.
 */
export const createSignedUpload = async (
  userId: string,
  kind: UploadKind,
  contentType: string,
  contentLength: number
): Promise<SignedUpload> => {
  assertUploadAllowed(kind, contentType, contentLength);

  const s3 = requireS3();
  const bucket = s3Bucket();
  const path = `${kind}/${userId}/${randomUUID()}.${extFor(contentType)}`;

  const upload_url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: path,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    {
      expiresIn: s3UploadUrlTtlSeconds(),
      // content-type is NOT signed by default (the S3 presigner explicitly adds
      // it to unsignableHeaders), and content-length only happens to be signed
      // because it is absent from ALWAYS_UNSIGNABLE_HEADERS. Naming both makes
      // the guarantee ours rather than an accident of SDK internals that a minor
      // version could quietly reverse.
      signableHeaders: new Set(['content-type', 'content-length']),
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
