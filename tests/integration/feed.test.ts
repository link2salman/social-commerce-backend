import { api, path } from '../helpers/app';
import { registerUsers, bearer, type TestUser } from '../helpers/factories';
import Video from '@models/feed/Video';
import Follow from '@models/social/Follow';
import Block from '@models/social/Block';

// Ranked "For You" feed (rankingService). We drive engagement/recency directly
// on the denormalized counters + created_at so each ranking factor can be
// isolated deterministically — counter *maintenance* is covered by the
// engagement tests; here we test the *ordering given* those counters.

const publishVideo = async (author: TestUser): Promise<string> => {
  const res = await api()
    .post(path('/videos'))
    .set('Authorization', bearer(author))
    .send({
      video_url: 'https://cdn.example.test/clip.mp4',
      thumbnail_url: 'https://cdn.example.test/poster.jpg',
      caption: 'clip',
      duration_ms: 12_000,
      product_ids: [],
    });
  if (res.status !== 201) throw new Error(`publish failed: ${res.status}`);
  return res.body.data.id as string;
};

interface VideoTuning {
  created_at?: Date;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}
const tune = (id: string, t: VideoTuning): Promise<unknown> =>
  Video.update(
    {
      created_at: t.created_at ?? new Date(),
      like_count: t.likes ?? 0,
      comment_count: t.comments ?? 0,
      share_count: t.shares ?? 0,
      save_count: t.saves ?? 0,
    },
    { where: { video_id: id }, silent: true }
  );

const forYou = (viewer: TestUser, cursor?: string, limit?: number) =>
  api()
    .get(path('/feed/for-you'))
    .query({ ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) })
    .set('Authorization', bearer(viewer));

// The feed is a GLOBAL collection and this file's tests share a DB (truncation
// is per-file), so videos from earlier tests coexist. Ordering tests request a
// full page (max 50) and assert the RELATIVE position of the rows they created —
// never an absolute index or count.
const FULL = 50;

const idsOf = (body: { items: Array<{ id: string }> }): string[] =>
  body.items.map(i => i.id);

const HOUR = 3_600_000;
const anchored = (msAgo: number): Date => new Date(Date.now() - msAgo);

describe('feed — ranked For You', () => {
  it('ranks a high-engagement clip above a fresh zero-engagement one', async () => {
    const [viewer, creator] = await registerUsers(2);
    const hot = await publishVideo(creator);
    const cold = await publishVideo(creator);
    const at = anchored(HOUR);
    await tune(hot, { likes: 80, comments: 20, created_at: at });
    await tune(cold, { created_at: at }); // same age, no engagement

    const res = await forYou(viewer, undefined, FULL);
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids.indexOf(hot)).toBeLessThan(ids.indexOf(cold));
  });

  it('decays by recency — a newer clip outranks an older one at equal engagement', async () => {
    const [viewer, creator] = await registerUsers(2);
    const fresh = await publishVideo(creator);
    const stale = await publishVideo(creator);
    await tune(fresh, { created_at: anchored(HOUR) }); // ~1h old
    await tune(stale, { created_at: anchored(10 * 24 * HOUR) }); // ~10d old

    const ids = idsOf((await forYou(viewer, undefined, FULL)).body);
    expect(ids.indexOf(fresh)).toBeLessThan(ids.indexOf(stale));
  });

  it('boosts videos from authors the viewer follows', async () => {
    const [viewer, followed, stranger] = await registerUsers(3);
    const mine = await publishVideo(followed);
    const theirs = await publishVideo(stranger);
    const at = anchored(HOUR);
    await tune(mine, { created_at: at }); // both zero-engagement, same age
    await tune(theirs, { created_at: at });
    await Follow.create({ follower_id: viewer.id, followee_id: followed.id });

    const ids = idsOf((await forYou(viewer, undefined, FULL)).body);
    expect(ids.indexOf(mine)).toBeLessThan(ids.indexOf(theirs));
  });

  it("excludes the viewer's own videos and blocked authors", async () => {
    const [viewer, normal, villain] = await registerUsers(3);
    const own = await publishVideo(viewer);
    const blockedClip = await publishVideo(villain);
    const visible = await publishVideo(normal);
    const at = anchored(HOUR);
    await Promise.all([
      tune(own, { created_at: at }),
      tune(blockedClip, { created_at: at }),
      tune(visible, { created_at: at }),
    ]);
    await Block.create({ blocker_id: viewer.id, blocked_id: villain.id });

    const ids = idsOf((await forYou(viewer, undefined, FULL)).body);
    expect(ids).toContain(visible);
    expect(ids).not.toContain(own);
    expect(ids).not.toContain(blockedClip);
  });

  it('cold start: a viewer with no graph still gets a ranked, non-empty feed', async () => {
    const [viewer, creator] = await registerUsers(2);
    const a = await publishVideo(creator);
    const b = await publishVideo(creator);
    const at = anchored(HOUR);
    await tune(a, { likes: 100, created_at: at });
    await tune(b, { likes: 1, created_at: at });

    const res = await forYou(viewer, undefined, FULL); // follows no one, engaged with nothing
    const ids = idsOf(res.body);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b)); // popularity-weighted
  });

  it('paginates stably and exhaustively (no dups, non-increasing score)', async () => {
    const [viewer, creator] = await registerUsers(2);
    const at = anchored(HOUR);
    const made: string[] = [];
    for (const likes of [10, 20, 30, 40, 50]) {
      const id = await publishVideo(creator);
      await tune(id, { likes, created_at: at });
      made.push(id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const res = await forYou(viewer, cursor, 2);
      expect(res.status).toBe(200);
      seen.push(...idsOf(res.body));
      cursor = res.body.next_cursor ?? undefined;
      if (!cursor) break;
    }

    // Every made video appears exactly once, highest-engagement first.
    for (const id of made) expect(seen.filter(s => s === id)).toHaveLength(1);
    const madeInOrder = seen.filter(s => made.includes(s));
    expect(madeInOrder).toEqual([...made].reverse()); // likes 50→10
  });

  it('returns the feed-card shape and an opaque/null next_cursor', async () => {
    const [viewer, creator] = await registerUsers(2);
    const id = await publishVideo(creator);
    await tune(id, { likes: 5, created_at: anchored(HOUR) });

    const res = await forYou(viewer, undefined, FULL);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["items", "message", "next_cursor", "success"]);
    // Find our own row (the feed is global) and assert the feed-card contract.
    const mine = res.body.items.find((i: { id: string }) => i.id === id);
    expect(mine).toMatchObject({
      id,
      author: { id: creator.id },
      stats: { likes: 5 },
    });
    expect(
      res.body.next_cursor === null || typeof res.body.next_cursor === 'string'
    ).toBe(true);
  });

  it('requires auth', async () => {
    const res = await api().get(path('/feed/for-you'));
    expect(res.status).toBe(401);
  });
});

describe('feed — Following stays chronological', () => {
  it('includes the viewer’s own videos, newest first, alongside followed authors', async () => {
    const [viewer, followed] = await registerUsers(2);
    const theirs = await publishVideo(followed);
    const mine = await publishVideo(viewer);
    await tune(theirs, { created_at: anchored(2 * HOUR) });
    await tune(mine, { created_at: anchored(HOUR) });
    await Follow.create({ follower_id: viewer.id, followee_id: followed.id });

    const res = await api()
      .get(path('/feed/following'))
      .set('Authorization', bearer(viewer));
    // A clip you just published has to be visible somewhere chronological —
    // "For You" excludes you by design, so this is the only timeline that can
    // show it. Matches getPostFeed, which has always included the viewer.
    expect(idsOf(res.body)).toEqual([mine, theirs]);
  });

  it('shows the viewer’s own videos even with no follows at all', async () => {
    const [viewer] = await registerUsers(1);
    const mine = await publishVideo(viewer);

    const res = await api()
      .get(path('/feed/following'))
      .set('Authorization', bearer(viewer));
    expect(idsOf(res.body)).toEqual([mine]);
  });

  it('returns only followed authors, newest first, and is empty without follows', async () => {
    const [viewer, followed] = await registerUsers(2);

    const empty = await api()
      .get(path('/feed/following'))
      .set('Authorization', bearer(viewer));
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);

    const older = await publishVideo(followed);
    const newer = await publishVideo(followed);
    await tune(older, { created_at: anchored(2 * HOUR) });
    await tune(newer, { created_at: anchored(HOUR) });
    await Follow.create({ follower_id: viewer.id, followee_id: followed.id });

    const res = await api()
      .get(path('/feed/following'))
      .set('Authorization', bearer(viewer));
    const ids = idsOf(res.body);
    expect(ids).toEqual([newer, older]); // reverse-chronological, no ranking
  });
});
