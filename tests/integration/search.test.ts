import { api, path } from '../helpers/app';
import {
  registerUser,
  registerUsers,
  bearer,
  createProduct,
  uniqueUsername,
  type TestUser,
} from '../helpers/factories';
import Block from '@models/social/Block';

// GET /search?type=&q= over products / videos / users. The feed is global and
// these tests share a DB, so each uses a UNIQUE token in the searchable text and
// asserts its own row is (or isn't) present — never a count.

const search = (u: TestUser, type: string, q: string) =>
  api().get(path('/search')).query({ type, q }).set('Authorization', bearer(u));

const publishVideo = async (author: TestUser, caption: string): Promise<string> => {
  const res = await api()
    .post(path('/videos'))
    .set('Authorization', bearer(author))
    .send({
      videoUrl: 'https://cdn.example.test/clip.mp4',
      thumbnailUrl: 'https://cdn.example.test/poster.jpg',
      caption,
      durationMs: 12_000,
      productIds: [],
    });
  if (res.status !== 201) throw new Error(`publish failed: ${res.status}`);
  return res.body.id as string;
};

const ids = (res: { body: { items: Array<{ id: string }> } }): string[] =>
  res.body.items.map(i => i.id);

describe('search', () => {
  describe('products', () => {
    it('matches by a title term (case-insensitive) and excludes non-matches', async () => {
      const u = await registerUser();
      const token = uniqueUsername('zx');
      const { product } = await createProduct({ title: `Vintage ${token} Jacket` });
      const other = await createProduct({ title: 'Unrelated Boots' });

      const res = await search(u, 'products', token.toUpperCase());
      expect(res.status).toBe(200);
      expect(ids(res)).toContain(product.product_id);
      expect(ids(res)).not.toContain(other.product.product_id);
    });

    it('matches by a description term', async () => {
      const u = await registerUser();
      const token = uniqueUsername('zd');
      const { product } = await createProduct({
        title: 'Plain Tee',
        description: `Made of ${token} organic cotton`,
      });

      expect(ids(await search(u, 'products', token))).toContain(product.product_id);
    });

    it('returns empty items for an empty query', async () => {
      const u = await registerUser();
      const res = await search(u, 'products', '');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });
  });

  describe('videos', () => {
    it('matches a caption term and a #hashtag (leading # stripped)', async () => {
      const [viewer, author] = await registerUsers(2);
      const tag = uniqueUsername('trip');
      const id = await publishVideo(author, `sunset vibes #${tag} from the roof`);

      expect(ids(await search(viewer, 'videos', tag))).toContain(id);
      expect(ids(await search(viewer, 'videos', `#${tag}`))).toContain(id);
    });

    it('excludes videos from authors the viewer blocked', async () => {
      const [viewer, villain] = await registerUsers(2);
      const tag = uniqueUsername('blk');
      const id = await publishVideo(villain, `spam spam #${tag}`);
      await Block.create({ blocker_id: viewer.id, blocked_id: villain.id });

      expect(ids(await search(viewer, 'videos', tag))).not.toContain(id);
    });
  });

  describe('users', () => {
    it('delegates to people search', async () => {
      const viewer = await registerUser();
      const target = await registerUser();
      const res = await search(viewer, 'users', target.username);
      expect(res.status).toBe(200);
      expect(ids(res)).toContain(target.id);
    });
  });

  describe('validation & auth', () => {
    it('400s on an unknown or missing type', async () => {
      const u = await registerUser();
      expect((await search(u, 'widgets', 'x')).status).toBe(400);
      const missing = await api()
        .get(path('/search'))
        .query({ q: 'x' })
        .set('Authorization', bearer(u));
      expect(missing.status).toBe(400);
    });

    it('401s without auth', async () => {
      const res = await api().get(path('/search')).query({ type: 'products', q: 'x' });
      expect(res.status).toBe(401);
    });
  });
});
