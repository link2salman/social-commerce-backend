import { api, path } from '../helpers/app';
import { registerUser, bearer, type TestUser } from '../helpers/factories';
import { MAX_UPLOAD_BYTES } from '@constants/media';

// POST /uploads/sign — the presigned-upload contract.
//
// `.env.test` deliberately leaves S3_BUCKET empty (the contract suite asserts
// uploads 503 while storage is unconfigured), so this file turns storage ON for
// itself: `config/s3.ts` builds its client LAZILY on the first getS3(), and Jest
// gives every test file its own module registry, so setting the env here before
// the first request configures storage for this file and nothing else. The env
// is restored afterwards anyway, because --runInBand shares one process.
//
// Nothing is mocked and nothing goes over the network: presigning is local SigV4
// crypto over throwaway credentials, so the URL asserted below is byte-for-byte
// the URL a real deploy would mint.
const TEST_BUCKET = 'iovibe-test-media';
const PUBLIC_BASE = `https://${TEST_BUCKET}.s3.us-east-1.amazonaws.com`;

const MB = 1024 * 1024;
/** A plausible compressed 60s clip — comfortably inside every ceiling. */
const SMALL = 2 * MB;

const originalEnv = {
  S3_BUCKET: process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
};

interface SignBody {
  kind?: string;
  content_type?: string;
  content_length?: number;
}

const sign = (user: TestUser, body: SignBody) =>
  api()
    .post(path('/uploads/sign'))
    .set('Authorization', bearer(user))
    .send(body);

describe('uploads', () => {
  let user: TestUser;

  beforeAll(async () => {
    process.env.S3_BUCKET = TEST_BUCKET;
    process.env.S3_REGION = 'us-east-1';
    // Explicit (throwaway) keys so the SDK never reaches for the ambient
    // credential chain — an IMDS lookup in CI would hang, not fail fast.
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY =
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    user = await registerUser();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('POST /uploads/sign — happy path', () => {
    it('issues a signed URL, an object key and the public playback URL', async () => {
      const res = await sign(user, {
        kind: 'video',
        content_type: 'video/mp4',
        content_length: SMALL,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(Object.keys(res.body.data).sort()).toEqual([
        'path',
        'public_url',
        'upload_url',
      ]);

      const { path: key, public_url, upload_url } = res.body.data;
      // `${kind}/${userId}/${uuid}.${ext}` — the prefix is what makes the bucket
      // browsable and a per-user retention rule expressible.
      expect(key).toMatch(
        new RegExp(`^video/${user.id}/[0-9a-f-]{36}\\.mp4$`)
      );
      expect(public_url).toBe(`${PUBLIC_BASE}/${key}`);
      expect(upload_url.startsWith(`${PUBLIC_BASE}/${key}?`)).toBe(true);
    });

    it('binds the upload to BOTH its declared size and its content type', async () => {
      // The whole point of the change. A presigned PUT has no size *range* —
      // the only lever is which headers the signature covers, and a covered
      // header must arrive with exactly the signed value or S3 answers 403
      // SignatureDoesNotMatch before storing anything. So `content-length` in
      // SignedHeaders IS the size limit; without it the URL takes any number of
      // bytes the caller feels like sending.
      const res = await sign(user, {
        kind: 'video',
        content_type: 'video/mp4',
        content_length: SMALL,
      });

      const url = new URL(res.body.data.upload_url);
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
        'content-length;content-type;host'
      );
      // Short-lived too: an unexpired stray URL is a second way to write bytes.
      expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(
        900
      );
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    });

    it('maps each accepted content type to its own extension', async () => {
      const cases: Array<[string, string, string]> = [
        ['video', 'video/quicktime', 'mov'],
        ['image', 'image/jpeg', 'jpg'],
        ['image', 'image/png', 'png'],
        ['avatar', 'image/heic', 'heic'],
        ['chat', 'image/webp', 'webp'],
      ];
      for (const [kind, content_type, ext] of cases) {
        const res = await sign(user, { kind, content_type, content_length: SMALL });
        expect(res.status).toBe(201);
        expect(res.body.data.path.endsWith(`.${ext}`)).toBe(true);
      }
    });
  });

  describe('POST /uploads/sign — size ceiling', () => {
    it('refuses an upload over the ceiling for its kind', async () => {
      const res = await sign(user, {
        kind: 'avatar',
        content_type: 'image/jpeg',
        content_length: MAX_UPLOAD_BYTES.avatar + 1,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UPLOAD_TOO_LARGE');
      expect(res.body.message).toMatch(/too large/i);
    });

    it('accepts exactly the ceiling — the bound is inclusive', async () => {
      const res = await sign(user, {
        kind: 'avatar',
        content_type: 'image/jpeg',
        content_length: MAX_UPLOAD_BYTES.avatar,
      });

      expect(res.status).toBe(201);
    });

    it('applies a DIFFERENT ceiling per kind', async () => {
      // A size that is fine for a clip and absurd for a profile picture. Without
      // per-kind ceilings the avatar folder is a video host.
      const size = MAX_UPLOAD_BYTES.avatar * 4;
      expect(size).toBeLessThan(MAX_UPLOAD_BYTES.video);

      const asVideo = await sign(user, {
        kind: 'video',
        content_type: 'video/mp4',
        content_length: size,
      });
      expect(asVideo.status).toBe(201);

      const asAvatar = await sign(user, {
        kind: 'avatar',
        content_type: 'image/jpeg',
        content_length: size,
      });
      expect(asAvatar.status).toBe(400);
      expect(asAvatar.body.code).toBe('UPLOAD_TOO_LARGE');
    });

    it('requires content_length — an unsized request cannot be bounded', async () => {
      const res = await sign(user, { kind: 'video', content_type: 'video/mp4' });

      // 400, never a signed URL: omitting the size is exactly the hole the
      // signature closes, so it must not be an opt-out.
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'content_length' }),
        ])
      );
    });

    it('rejects a non-positive or fractional size', async () => {
      for (const content_length of [0, -1, 1.5]) {
        const res = await sign(user, {
          kind: 'video',
          content_type: 'video/mp4',
          content_length,
        });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('POST /uploads/sign — content type allowlist', () => {
    it('refuses a type that is not on the allowlist', async () => {
      const res = await sign(user, {
        kind: 'image',
        content_type: 'application/zip',
        content_length: SMALL,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('refuses a type that is real media but wrong for this kind', async () => {
      const res = await sign(user, {
        kind: 'avatar',
        content_type: 'video/mp4',
        content_length: SMALL,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('no longer invents an extension from an arbitrary MIME subtype', async () => {
      // The old extFor() fell back to the subtype, so `text/html` parked a
      // .html object in a publicly readable bucket.
      const res = await sign(user, {
        kind: 'image',
        content_type: 'text/html',
        content_length: SMALL,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rejects an unknown kind', async () => {
      const res = await sign(user, {
        kind: 'invoice',
        content_type: 'image/jpeg',
        content_length: SMALL,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /uploads/sign — auth', () => {
    it('401s without a token', async () => {
      const res = await api()
        .post(path('/uploads/sign'))
        .send({ kind: 'video', content_type: 'video/mp4', content_length: SMALL });

      expect(res.status).toBe(401);
    });
  });
});
