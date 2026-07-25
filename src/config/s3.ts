import { S3Client } from '@aws-sdk/client-s3';
import { numberEnv, optionalEnv, boolEnv } from '@utils/env';
import logger from '@utils/logger';

// S3 is OPTIONAL at boot (like Stripe): the server runs without it, but upload
// endpoints return 503 until S3_BUCKET is set. Same "wired but disabled until
// you drop in the env value" contract as every other integration.
//
// Credentials come from the standard AWS chain: explicit AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY when present, otherwise the ambient provider (EC2/ECS
// task role, IRSA, ~/.aws/credentials). We only pass creds explicitly when they
// are in env, so an instance-role deploy needs no keys at all.
//
// S3_ENDPOINT points the client at any S3-compatible service instead of AWS:
// MinIO for local dev (see docker-compose.yml), Cloudflare R2, DigitalOcean
// Spaces. Those need path-style addressing (S3_FORCE_PATH_STYLE=true) because
// they don't do bucket-as-subdomain.

let client: S3Client | null = null;
let initialized = false;

export const getS3 = (): S3Client | null => {
  if (initialized) return client;
  initialized = true;

  const bucket = optionalEnv('S3_BUCKET');
  if (!bucket) {
    logger.warn('S3_BUCKET not set — upload endpoints will return 503.');
    return null;
  }

  const endpoint = optionalEnv('S3_ENDPOINT');
  const accessKeyId = optionalEnv('AWS_ACCESS_KEY_ID');
  const secretAccessKey = optionalEnv('AWS_SECRET_ACCESS_KEY');

  client = new S3Client({
    region: s3Region(),
    ...(endpoint ? { endpoint } : {}),
    // Custom endpoints (MinIO, R2, Spaces) address buckets by path, not
    // subdomain. On real AWS the default virtual-hosted style is correct.
    forcePathStyle: boolEnv('S3_FORCE_PATH_STYLE', Boolean(endpoint)),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  logger.info(
    { bucket, endpoint: endpoint || 'aws', region: s3Region() },
    'S3 media storage initialized.'
  );
  return client;
};

export const isStorageConfigured = (): boolean => getS3() !== null;

/** Bucket that holds every uploaded asset (path-prefixed by kind). */
export const s3Bucket = (): string => optionalEnv('S3_BUCKET');

export const s3Region = (): string => optionalEnv('S3_REGION', 'us-east-1');

/** Lifetime of a signed upload URL. Short: the client PUTs immediately. */
export const s3UploadUrlTtlSeconds = (): number =>
  numberEnv('S3_UPLOAD_URL_TTL_SECONDS', 900);

/**
 * Base URL objects are publicly readable at — a CloudFront/CDN domain, or the
 * bucket's own website/REST endpoint. Set S3_PUBLIC_BASE_URL to serve media
 * through a CDN; otherwise we derive the direct endpoint. Returned without a
 * trailing slash.
 *
 * Playback URLs are persisted on the resource (a video, an avatar), so this
 * must be a STABLE public URL — not a signed GET that expires. The bucket (or
 * the `media/` prefix) therefore needs public read access; see INTEGRATIONS.md.
 */
export const s3PublicBaseUrl = (): string => {
  const explicit = optionalEnv('S3_PUBLIC_BASE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');

  const bucket = s3Bucket();
  const endpoint = optionalEnv('S3_ENDPOINT');
  if (endpoint) return `${endpoint.replace(/\/+$/, '')}/${bucket}`;
  return `https://${bucket}.s3.${s3Region()}.amazonaws.com`;
};
