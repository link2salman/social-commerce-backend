import { randomUUID } from 'crypto';
import { api, path } from '../helpers/app';
import { bearer, registerUser, registerUsers, type TestUser } from '../helpers/factories';

// The image/text post feature end-to-end: create, feed, detail, engagement
// (like/dislike exclusivity + save), share, saved list, profile posts, and the
// post comment thread. Mirrors the video suites; fixtures are built through the
// real API.

type MediaItem = { type: 'image' | 'video'; url: string; thumbnail_url?: string | null; duration_ms?: number };

const createPost = (author: TestUser, body: string, media: MediaItem[] = []) =>
  api()
    .post(path('/posts'))
    .set('Authorization', bearer(author))
    .send({ body, media });

const img = (url: string): MediaItem => ({ type: 'image', url });

const engage = (
  user: TestUser,
  post_id: string,
  action: string,
  on = true
) => {
  const req = api()[on ? 'post' : 'delete'](path(`/posts/${post_id}/${action}`));
  return req.set('Authorization', bearer(user));
};

describe('posts — create (POST /posts)', () => {
  it('creates a text-only post (201) with the full wire shape', async () => {
    const author = await registerUser();
    const res = await createPost(author, 'hello world, my first post');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      body: 'hello world, my first post',
      media: [],
      author: { id: author.id, username: author.username, is_following: false },
      stats: { likes: 0, dislikes: 0, comments: 0, shares: 0, saves: 0 },
      viewer: {
        has_liked: false,
        has_disliked: false,
        has_saved: false,
        has_bookmarked: false,
        has_favorited: false,
      },
    });
    expect(typeof res.body.data.id).toBe('string');
    expect(typeof res.body.data.created_at).toBe('string');
  });

  it('creates an image post (201) with ordered media', async () => {
    const author = await registerUser();
    const res = await createPost(author, 'swipe →', [
      img('https://cdn.example.test/1.jpg'),
      img('https://cdn.example.test/2.jpg'),
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.media).toEqual([
      { type: 'image', url: 'https://cdn.example.test/1.jpg', thumbnail_url: null, duration_ms: null, position: 0 },
      { type: 'image', url: 'https://cdn.example.test/2.jpg', thumbnail_url: null, duration_ms: null, position: 1 },
    ]);
  });

  it('creates a video post (201) and generates a poster when none is given', async () => {
    const author = await registerUser();
    const res = await createPost(author, 'my clip', [
      { type: 'video', url: 'https://cdn.example.test/clip.mp4', duration_ms: 12_000 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.media).toHaveLength(1);
    const m = res.body.data.media[0];
    expect(m.type).toBe('video');
    expect(m.url).toBe('https://cdn.example.test/clip.mp4');
    expect(m.duration_ms).toBe(12_000);
    expect(typeof m.thumbnail_url).toBe('string'); // poster generated server-side
  });

  it('rejects an empty post — no text and no media (400)', async () => {
    const author = await registerUser();
    const res = await createPost(author, '   ', []);
    expect(res.status).toBe(400);
  });

  it('rejects an unauthenticated create (401)', async () => {
    const res = await api().post(path('/posts')).send({ body: 'nope' });
    expect(res.status).toBe(401);
  });
});

describe('posts — feed & detail', () => {
  it('returns the feed page shape and includes a fresh post', async () => {
    const author = await registerUser();
    const created = await createPost(author, 'feed me');
    const res = await api()
      .get(path('/posts/feed'))
      .set('Authorization', bearer(author));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('next_cursor');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.some((p: { id: string }) => p.id === created.body.data.id)).toBe(true);
  });

  it('returns a single post (200) and 404s an unknown id', async () => {
    const author = await registerUser();
    const created = await createPost(author, 'detail me');
    const ok = await api()
      .get(path(`/posts/${created.body.data.id}`))
      .set('Authorization', bearer(author));
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe(created.body.data.id);

    const missing = await api()
      .get(path(`/posts/${randomUUID()}`))
      .set('Authorization', bearer(author));
    expect(missing.status).toBe(404);
  });
});

describe('posts — engagement', () => {
  it('likes and unlikes, keeping stats + viewer flags coherent', async () => {
    const [author, viewer] = await registerUsers(2);
    const created = await createPost(author, 'like me');
    const id = created.body.data.id;

    expect((await engage(viewer, id, 'like')).status).toBe(200);
    let detail = await api().get(path(`/posts/${id}`)).set('Authorization', bearer(viewer));
    expect(detail.body.data.viewer.has_liked).toBe(true);
    expect(detail.body.data.stats.likes).toBe(1);

    expect((await engage(viewer, id, 'like', false)).status).toBe(200);
    detail = await api().get(path(`/posts/${id}`)).set('Authorization', bearer(viewer));
    expect(detail.body.data.viewer.has_liked).toBe(false);
    expect(detail.body.data.stats.likes).toBe(0);
  });

  it('enforces like/dislike mutual exclusion', async () => {
    const [author, viewer] = await registerUsers(2);
    const created = await createPost(author, 'react to me');
    const id = created.body.data.id;

    await engage(viewer, id, 'like');
    await engage(viewer, id, 'dislike'); // should drop the like
    const detail = await api().get(path(`/posts/${id}`)).set('Authorization', bearer(viewer));
    expect(detail.body.data.viewer.has_liked).toBe(false);
    expect(detail.body.data.viewer.has_disliked).toBe(true);
    expect(detail.body.data.stats.likes).toBe(0);
    expect(detail.body.data.stats.dislikes).toBe(1);
  });

  it('rejects an unknown engagement action (404)', async () => {
    const author = await registerUser();
    const created = await createPost(author, 'x');
    const res = await engage(author, created.body.data.id, 'smile');
    expect(res.status).toBe(404);
  });

  it('records a share and returns the new count', async () => {
    const author = await registerUser();
    const created = await createPost(author, 'share me');
    const res = await api()
      .post(path(`/posts/${created.body.data.id}/share`))
      .set('Authorization', bearer(author));
    expect(res.status).toBe(200);
    expect(res.body.data.share_count).toBe(1);
  });
});

describe('posts — saved list & profile posts', () => {
  it('lists a saved post under GET /posts/saved', async () => {
    const [author, viewer] = await registerUsers(2);
    const created = await createPost(author, 'save me to the list');
    await engage(viewer, created.body.data.id, 'save');

    const res = await api()
      .get(path('/posts/saved'))
      .set('Authorization', bearer(viewer));
    expect(res.status).toBe(200);
    expect(res.body.items.some((p: { id: string }) => p.id === created.body.data.id)).toBe(true);
    // A viewer who didn't save it sees an empty (or non-containing) list.
    const other = await registerUser();
    const otherRes = await api()
      .get(path('/posts/saved'))
      .set('Authorization', bearer(other));
    expect(otherRes.body.items.some((p: { id: string }) => p.id === created.body.data.id)).toBe(false);
  });

  it('lists a user’s own posts under GET /users/:id/posts', async () => {
    const author = await registerUser();
    const created = await createPost(author, 'on my profile');
    const res = await api()
      .get(path(`/users/${author.id}/posts`))
      .set('Authorization', bearer(author));
    expect(res.status).toBe(200);
    expect(res.body.items.some((p: { id: string }) => p.id === created.body.data.id)).toBe(true);
  });
});

describe('post comments', () => {
  it('posts a comment, a reply, and toggles a comment like', async () => {
    const [author, commenter] = await registerUsers(2);
    const post = await createPost(author, 'comment on me');
    const post_id = post.body.data.id;

    const top = await api()
      .post(path(`/posts/${post_id}/comments`))
      .set('Authorization', bearer(commenter))
      .send({ body: 'great post!' });
    expect(top.status).toBe(201);
    expect(top.body.data).toMatchObject({ body: 'great post!', parent_id: null, reply_count: 0 });

    const reply = await api()
      .post(path(`/posts/${post_id}/comments`))
      .set('Authorization', bearer(author))
      .send({ body: 'thanks!', parent_id: top.body.data.id });
    expect(reply.status).toBe(201);
    expect(reply.body.data.parent_id).toBe(top.body.data.id);

    // Top-level list carries the thread with a derived reply_count of 1.
    const list = await api()
      .get(path(`/posts/${post_id}/comments`))
      .set('Authorization', bearer(author));
    expect(list.status).toBe(200);
    const topInList = list.body.items.find((c: { id: string }) => c.id === top.body.data.id);
    expect(topInList.reply_count).toBe(1);

    // Replies endpoint returns the reply.
    const replies = await api()
      .get(path(`/post-comments/${top.body.data.id}/replies`))
      .set('Authorization', bearer(author));
    expect(replies.body.items.some((c: { id: string }) => c.id === reply.body.data.id)).toBe(true);

    // Comment like toggles.
    expect(
      (await api()
        .post(path(`/post-comments/${top.body.data.id}/like`))
        .set('Authorization', bearer(author))).status
    ).toBe(200);
    const afterLike = await api()
      .get(path(`/posts/${post_id}/comments`))
      .set('Authorization', bearer(author));
    const likedTop = afterLike.body.items.find((c: { id: string }) => c.id === top.body.data.id);
    expect(likedTop.has_liked).toBe(true);
    expect(likedTop.likes).toBe(1);

    // Post's comment_count reflects both comment + reply.
    const detail = await api().get(path(`/posts/${post_id}`)).set('Authorization', bearer(author));
    expect(detail.body.data.stats.comments).toBe(2);
  });

  it('rejects an empty comment body (400) and an unauthenticated comment (401)', async () => {
    const author = await registerUser();
    const post = await createPost(author, 'guard me');
    const empty = await api()
      .post(path(`/posts/${post.body.data.id}/comments`))
      .set('Authorization', bearer(author))
      .send({ body: '   ' });
    expect(empty.status).toBe(400);

    const unauth = await api()
      .post(path(`/posts/${post.body.data.id}/comments`))
      .send({ body: 'hi' });
    expect(unauth.status).toBe(401);
  });
});
