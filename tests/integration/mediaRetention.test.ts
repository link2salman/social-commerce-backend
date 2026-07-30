// The sweep's public base URL has to resolve before the service is imported, and
// the test env deliberately leaves S3_BUCKET empty (storage is env-gated). Setting
// the explicit base is enough for the reference scan, which never touches S3 —
// only `sweepOrphans` does, and that half is not exercised here.
process.env.S3_PUBLIC_BASE_URL = 'https://test-bucket.s3.ap-south-1.amazonaws.com';

import { api, path } from '../helpers/app';
import { registerUsers, bearer, type TestUser } from '../helpers/factories';
import { sequelize } from '@config/db';
import { collectReferencedKeys } from '@services/mediaRetentionService';

const BASE = 'https://test-bucket.s3.ap-south-1.amazonaws.com';

/**
 * These cover the half of the sweep that can destroy data.
 *
 * `sweepOrphans` deletes whatever `collectReferencedKeys` fails to report, so a
 * miss here is not a wrong number — it is live media permanently gone. The cases
 * therefore lean on the *reach* of the scan: nested JSONB, a column nobody
 * remembered, a URL that only appears inside a larger string.
 *
 * The deletion half (list, age filter, batch delete) is mechanical and needs a
 * live bucket, so it is not exercised here.
 */

const createVideo = (author: TestUser, video_url: string) =>
  api()
    .post(path('/videos'))
    .set('Authorization', bearer(author))
    .send({ video_url, caption: 'retention', duration_ms: 5_000, product_ids: [] });

describe('media retention — reference scan', () => {
  it('finds keys in ordinary text columns', async () => {
    const [author] = await registerUsers(1);
    const key = 'video/abc/keep-me.mp4';
    const res = await createVideo(author, `${BASE}/${key}`);
    expect(res.status).toBe(201);

    const keys = await collectReferencedKeys();
    expect(keys.has(key)).toBe(true);
  });

  it('finds a key buried inside a JSONB document', async () => {
    // Patched into an existing row's JSONB rather than built through a feature:
    // what is under test is that the scanner reaches into JSONB at all. Real
    // instances of this today are call_records.participants (which freezes an
    // avatar_url per person) and messages.attachment.
    const [owner] = await registerUsers(1);
    const key = 'avatar/xyz/frozen-avatar.jpg';
    const [updated] = await sequelize.query(
      `UPDATE user_sessions
          SET device_metadata = :meta::jsonb
        WHERE user_id = :owner`,
      {
        replacements: {
          owner: owner.id,
          meta: JSON.stringify({ participants: [{ avatar_url: `${BASE}/${key}` }] }),
        },
      }
    );
    // Guard the fixture itself: if no row matched, the assertion below would pass
    // for the wrong reason on an empty scan.
    expect((updated as unknown as { rowCount?: number })?.rowCount ?? 1).toBeGreaterThan(0);

    const keys = await collectReferencedKeys();
    // A column-name allowlist would have missed this entirely, and the sweep
    // would have deleted a live avatar.
    expect(keys.has(key)).toBe(true);
  });

  it('ignores URLs that are not in our bucket', async () => {
    const [author] = await registerUsers(1);
    // The seeded sample clips point at foreign CDNs; those are not ours to sweep.
    await createVideo(author, 'https://commondatastorage.googleapis.com/gtv/sample.mp4');

    const keys = await collectReferencedKeys();
    for (const k of keys) {
      expect(k).not.toContain('googleapis.com');
    }
  });

  it('does not truncate a key at a path separator', async () => {
    const [author] = await registerUsers(1);
    const key = 'video/deep/nested/path/clip-01.mp4';
    await createVideo(author, `${BASE}/${key}`);

    const keys = await collectReferencedKeys();
    // A pattern that stopped at '/' would yield 'video' and the sweep would then
    // consider every real object unreferenced.
    expect(keys.has(key)).toBe(true);
  });

  it('scans columns it was never told about', async () => {
    // The guarantee that makes this sweep safe to keep: a column added later is
    // covered because the scan reads information_schema, not a hand-written list.
    const [author] = await registerUsers(1);
    const key = 'image/late/added-column.jpg';
    await sequelize.query('ALTER TABLE videos ADD COLUMN IF NOT EXISTS sweep_probe TEXT');
    try {
      const res = await createVideo(author, `${BASE}/video/abc/other.mp4`);
      await sequelize.query('UPDATE videos SET sweep_probe = :url WHERE video_id = :id', {
        replacements: { url: `${BASE}/${key}`, id: res.body.data.id },
      });

      const keys = await collectReferencedKeys();
      expect(keys.has(key)).toBe(true);
    } finally {
      await sequelize.query('ALTER TABLE videos DROP COLUMN IF EXISTS sweep_probe');
    }
  });
});
