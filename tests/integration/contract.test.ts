import { api, path } from '../helpers/app';
import {
  registerUser,
  registerUsers,
  bearer,
  createProduct,
  daysFromNow,
} from '../helpers/factories';

// ─────────────────────────────────────────────────────────────────────────────
// The single most breakable promise this backend makes.
//
// The mobile client validates every response at its network boundary with
// `schema.parse(json)` on the WHOLE body. So a success response IS the schema —
// there is no {success, data} envelope (the reference backend has one; this one
// deliberately does not). If an envelope ever creeps back in, every screen in
// the app throws at its Zod boundary and NOTHING here would fail without this
// test. See ARCHITECTURE.md § "The client is the spec" and utils/respond.ts.
// ─────────────────────────────────────────────────────────────────────────────

// Keys that would only ever appear because someone wrapped the payload. NOT
// included: `status` — it is a real contract field (Message.status, Order.status),
// which is exactly why the guard has to be a curated list rather than a
// "no unexpected keys" sweep.
const ENVELOPE_KEYS = ['success', 'data', 'meta', 'payload'] as const;

/** Assert a success body is the raw shape — no wrapper keys, no metadata. */
const expectRawShape = (body: unknown, label: string): void => {
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  const keys = Object.keys(body as Record<string, unknown>);

  for (const forbidden of ENVELOPE_KEYS) {
    expect({ endpoint: label, key: forbidden, present: keys.includes(forbidden) }).toEqual({
      endpoint: label,
      key: forbidden,
      present: false,
    });
  }
};

describe('response contract', () => {
  describe('success bodies are RAW — no {success,data} envelope', () => {
    it('holds across every domain', async () => {
      const [user, peer] = await registerUsers(2);
      const { product } = await createProduct({ priceCents: 0 });
      const auth = bearer(user);

      // Auth — SessionSchema at top level.
      const login = await api()
        .post(path('/auth/login'))
        .send({ email: user.email, password: user.password });
      expect(login.status).toBe(200);
      expectRawShape(login.body, 'POST /auth/login');
      expect(Object.keys(login.body).sort()).toEqual([
        'accessToken',
        'refreshToken',
        'userId',
      ]);

      // Social — User at top level, not { data: User }.
      const profile = await api().get(path(`/users/${peer.id}`)).set('Authorization', auth);
      expect(profile.status).toBe(200);
      expectRawShape(profile.body, 'GET /users/:id');
      expect(profile.body.id).toBe(peer.id);
      expect(profile.body.stats).toBeDefined();

      // Cursor page — { items, nextCursor } at top level.
      const followers = await api()
        .get(path(`/users/${peer.id}/followers`))
        .set('Authorization', auth);
      expect(followers.status).toBe(200);
      expectRawShape(followers.body, 'GET /users/:id/followers');
      expect(Object.keys(followers.body).sort()).toEqual(['items', 'nextCursor']);

      // Non-paginated list — { items } only, no nextCursor.
      const search = await api()
        .get(path('/users/search'))
        .query({ q: peer.username })
        .set('Authorization', auth);
      expect(search.status).toBe(200);
      expectRawShape(search.body, 'GET /users/search');
      expect(Object.keys(search.body)).toEqual(['items']);

      // Commerce.
      const products = await api().get(path('/products')).set('Authorization', auth);
      expectRawShape(products.body, 'GET /products');
      expect(Object.keys(products.body)).toEqual(['items']);

      const cart = await api()
        .post(path('/cart/summary'))
        .set('Authorization', auth)
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 1 }] });
      expect(cart.status).toBe(200);
      expectRawShape(cart.body, 'POST /cart/summary');
      expect(Object.keys(cart.body).sort()).toEqual([
        'currency',
        'itemCount',
        'lines',
        'shipping',
        'subtotal',
        'tax',
        'total',
      ]);

      const orders = await api().get(path('/orders')).set('Authorization', auth);
      expectRawShape(orders.body, 'GET /orders');

      // Chat.
      const conversation = await api()
        .post(path(`/conversations/with/${peer.id}`))
        .set('Authorization', auth);
      expect(conversation.status).toBe(201);
      expectRawShape(conversation.body, 'POST /conversations/with/:id');
      expect(conversation.body.id).toBeDefined();

      const message = await api()
        .post(path(`/conversations/${conversation.body.id}/messages`))
        .set('Authorization', auth)
        .send({ body: 'shape check' });
      expect(message.status).toBe(201);
      expectRawShape(message.body, 'POST /conversations/:id/messages');

      const messages = await api()
        .get(path(`/conversations/${conversation.body.id}/messages`))
        .set('Authorization', auth);
      expectRawShape(messages.body, 'GET /conversations/:id/messages');
      expect(Object.keys(messages.body).sort()).toEqual(['items', 'typing']);

      // Events.
      const event = await api()
        .post(path('/events'))
        .set('Authorization', auth)
        .send({
          title: 'Shape Check',
          description: 'Contract test.',
          startsAt: daysFromNow(3),
          endsAt: null,
          locationName: 'Somewhere',
          priceCents: 0,
          latitude: null,
          longitude: null,
        });
      expect(event.status).toBe(201);
      expectRawShape(event.body, 'POST /events');
      expect(event.body.id).toBeDefined();

      const events = await api().get(path('/events')).set('Authorization', auth);
      expectRawShape(events.body, 'GET /events');
      expect(Object.keys(events.body)).toEqual(['items']);

      // Calls.
      const calls = await api().get(path('/calls')).set('Authorization', auth);
      expect(calls.status).toBe(200);
      expectRawShape(calls.body, 'GET /calls');

      // Feed.
      const feed = await api().get(path('/feed/for-you')).set('Authorization', auth);
      expect(feed.status).toBe(200);
      expectRawShape(feed.body, 'GET /feed/for-you');
      expect(Object.keys(feed.body).sort()).toEqual(['items', 'nextCursor']);
    });

    it('acknowledges toggle mutations with exactly { ok: true }', async () => {
      const [user, peer] = await registerUsers(2);
      const auth = bearer(user);

      const follow = await api()
        .post(path(`/users/${peer.id}/follow`))
        .set('Authorization', auth);
      expect(follow.status).toBe(200);
      expect(follow.body).toEqual({ ok: true });

      const unfollow = await api()
        .delete(path(`/users/${peer.id}/follow`))
        .set('Authorization', auth);
      expect(unfollow.body).toEqual({ ok: true });

      const device = await api()
        .post(path('/devices'))
        .set('Authorization', auth)
        .send({ token: 'fcm-token-for-contract-test', platform: 'ios' });
      expect(device.status).toBe(201);
      expect(device.body).toEqual({ ok: true });
    });

    it('never leaks the password hash on any user-bearing shape', async () => {
      const [user, peer] = await registerUsers(2);
      const auth = bearer(user);

      const profile = await api().get(path(`/users/${peer.id}`)).set('Authorization', auth);
      const serialized = JSON.stringify(profile.body);

      expect(serialized).not.toMatch(/password/i);
      expect(serialized).not.toMatch(/\$2[aby]\$/); // a bcrypt hash prefix
      expect(profile.body.email).toBeUndefined(); // email is not part of UserSchema
    });
  });

  describe('error bodies carry a small { message }', () => {
    it('uses { message } for 401 / 404 and adds { errors } for a 400', async () => {
      const unauthorized = await api().get(path('/orders'));
      expect(unauthorized.status).toBe(401);
      expect(Object.keys(unauthorized.body)).toEqual(['message']);
      expect(typeof unauthorized.body.message).toBe('string');

      const user = await registerUser();
      const notFound = await api()
        .get(path('/users/00000000-0000-4000-8000-000000000000'))
        .set('Authorization', bearer(user));
      expect(notFound.status).toBe(404);
      expect(Object.keys(notFound.body)).toEqual(['message']);

      const invalid = await api().post(path('/auth/login')).send({ email: 'x', password: 'y' });
      expect(invalid.status).toBe(400);
      expect(Object.keys(invalid.body).sort()).toEqual(['errors', 'message']);
      // No `success: false` — the client branches on the status code alone.
      expect(invalid.body.success).toBeUndefined();
    });

    it('never includes a stack trace outside development', async () => {
      const res = await api().get(path('/orders'));

      expect(process.env.NODE_ENV).toBe('test');
      expect(res.body.stack).toBeUndefined();
    });
  });

  describe('integration gating — wired but disabled until the key is set', () => {
    it('503s media uploads while Supabase Storage is unconfigured', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/uploads/sign'))
        .set('Authorization', bearer(user))
        .send({ kind: 'video', contentType: 'video/mp4' });

      // 503 (not 500, not a silent success) so the client can tell "not wired
      // yet" apart from a client mistake or a crash. See INTEGRATIONS.md.
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/media storage is not configured/i);
      expect(res.body.message).toMatch(/SUPABASE_URL/);
    });

    it('still validates the upload body BEFORE the gate', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/uploads/sign'))
        .set('Authorization', bearer(user))
        .send({ kind: 'not-a-kind', contentType: 'video/mp4' });

      expect(res.status).toBe(400);
    });

    it('503s a priced checkout while Stripe is unconfigured', async () => {
      const user = await registerUser();
      const { product } = await createProduct({ priceCents: 4200 });

      const res = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(user))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 1 }] });

      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/payments are not configured/i);
      expect(res.body.message).toMatch(/STRIPE_SECRET_KEY/);
    });

    it('503s the Stripe webhook while the signing secret is unconfigured', async () => {
      const res = await api()
        .post(path('/webhooks/stripe'))
        .set('Content-Type', 'application/json')
        .send(Buffer.from(JSON.stringify({ id: 'evt_test', type: 'payment_intent.succeeded' })));

      // Never 200 — an unverifiable event must not be acted on.
      expect(res.status).toBe(503);
    });

    it('requires auth on the gated endpoints too — auth precedes the gate', async () => {
      const upload = await api()
        .post(path('/uploads/sign'))
        .send({ kind: 'video', contentType: 'video/mp4' });
      expect(upload.status).toBe(401);
    });
  });
});
