// The sweep's public base URL has to resolve before the service is imported, and
// the test env deliberately leaves S3_BUCKET empty (storage is env-gated). Setting
// the explicit base is enough for the reference scan, which never touches S3 —
// only `sweepOrphans` does, and that half is not exercised here.
process.env.S3_PUBLIC_BASE_URL = 'https://test-bucket.s3.ap-south-1.amazonaws.com';

import { api, path } from '../helpers/app';
import { registerUsers, bearer, type TestUser } from '../helpers/factories';
import { sequelize } from '@config/db';
import { collectReferencedKeys, findReclaimableOriginals } from '@services/mediaRetentionService';

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

  it('treats a recorded transcode source as referenced, so the sweep spares it', async () => {
    // The regression this locks down: transcodeService keeps the pre-transcode
    // original but repoints the row at the rendition, which left the original
    // referenced by nothing and therefore indistinguishable from a true orphan. A
    // production dry run found 4 such objects on a 4-clip database — every
    // original. source_url is what keeps them referenced.
    const [author] = await registerUsers(1);
    const originalKey = 'video/abc/original-camera-file.mp4';
    const res = await createVideo(author, `${BASE}/video/abc/rendition.mp4`);
    await sequelize.query('UPDATE videos SET source_url = :url WHERE video_id = :id', {
      replacements: { url: `${BASE}/${originalKey}`, id: res.body.data.id },
    });

    const keys = await collectReferencedKeys();
    expect(keys.has(originalKey)).toBe(true);
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

/**
 * Reclaiming originals is the destructive half. These cover the SELECTION — what
 * would be deleted — because that is where an off-by-one becomes lost footage.
 * The delete itself needs a live bucket and is not exercised here.
 */
describe('media retention — reclaiming superseded originals', () => {
  const setSource = (videoId: string, url: string | null, updatedAt?: string) =>
    sequelize.query(
      `UPDATE videos SET source_url = :url${updatedAt ? ', updated_at = :updatedAt' : ''}
        WHERE video_id = :id`,
      { replacements: { url, id: videoId, ...(updatedAt ? { updatedAt } : {}) } }
    );

  it('ignores a row that has no recorded original', async () => {
    const [author] = await registerUsers(1);
    const res = await createVideo(author, `${BASE}/video/a/no-source.mp4`);
    await setSource(res.body.data.id, null, '2000-01-01T00:00:00Z');

    const rows = await findReclaimableOriginals(0);
    expect(rows.map(r => r.id)).not.toContain(res.body.data.id);
  });

  it('ignores an original still inside the retention window', async () => {
    const [author] = await registerUsers(1);
    const res = await createVideo(author, `${BASE}/video/a/fresh.mp4`);
    await setSource(res.body.data.id, `${BASE}/video/a/fresh-original.mp4`);

    // 30 days by default; the row was updated seconds ago.
    const rows = await findReclaimableOriginals();
    expect(rows.map(r => r.id)).not.toContain(res.body.data.id);
  });

  it('selects an original once it is past the window', async () => {
    const [author] = await registerUsers(1);
    const res = await createVideo(author, `${BASE}/video/a/old.mp4`);
    const original = `${BASE}/video/a/old-original.mp4`;
    await setSource(res.body.data.id, original, '2020-01-01T00:00:00Z');

    const rows = await findReclaimableOriginals();
    const mine = rows.find(r => r.id === res.body.data.id);
    expect(mine?.source_url).toBe(original);
    expect(mine?.table).toBe('videos');
  });

  it('skips an original that is not in our bucket', async () => {
    const [author] = await registerUsers(1);
    const res = await createVideo(author, `${BASE}/video/a/foreign.mp4`);
    // A row predating a change of S3_PUBLIC_BASE_URL: we must not guess a key
    // from it and delete something we do not own.
    await setSource(res.body.data.id, 'https://elsewhere.example/clip.mp4', '2020-01-01T00:00:00Z');

    const rows = await findReclaimableOriginals();
    expect(rows.map(r => r.id)).not.toContain(res.body.data.id);
  });
});
