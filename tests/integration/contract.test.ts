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
// Every response is wrapped in the standard envelope (utils/responseHandler.ts):
//
//   one thing     { success, message, data }
//   a collection  { success, message, items, ...extra }
//   a cursor page { success, message, items, next_cursor }
//   an error      { success: false, message, code, errors? }
//
// …and every field inside is snake_case. The mobile client unwraps this in ONE
// place (core/api/client.ts → parseResponse) before its Zod boundary runs, so a
// response that forgets the envelope — or nests a list under `data` instead of
// putting `items` at the top level — throws in the app, not here.
//
// THIS FILE PREVIOUSLY ASSERTED THE OPPOSITE. The backend used to send raw,
// unwrapped bodies deliberately, and this test guarded that. That decision was
// reversed to match the reference backend (Ilaaf Online/io-backend); see
// ARCHITECTURE.md § "The client is the spec".
// ─────────────────────────────────────────────────────────────────────────────

/** Assert the envelope preamble every success body must carry. */
const expectEnvelope = (body: unknown, label: string): Record<string, unknown> => {
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  const b = body as Record<string, unknown>;
  expect({ endpoint: label, success: b.success }).toEqual({
    endpoint: label,
    success: true,
  });
  expect({ endpoint: label, message: typeof b.message }).toEqual({
    endpoint: label,
    message: 'string',
  });
  return b;
};

/** Envelope + the payload nested under `data` (a single resource). */
const expectData = (body: unknown, label: string): Record<string, unknown> => {
  const b = expectEnvelope(body, label);
  expect({ endpoint: label, hasData: 'data' in b }).toEqual({
    endpoint: label,
    hasData: true,
  });
  return b.data as Record<string, unknown>;
};

/** Envelope + a FLAT `items` array (a collection is never nested under data). */
const expectItems = (body: unknown, label: string): unknown[] => {
  const b = expectEnvelope(body, label);
  expect({ endpoint: label, isArray: Array.isArray(b.items) }).toEqual({
    endpoint: label,
    isArray: true,
  });
  expect({ endpoint: label, nestedData: 'data' in b }).toEqual({
    endpoint: label,
    nestedData: false,
  });
  return b.items as unknown[];
};

describe('response contract', () => {
  describe('success bodies carry the { success, message, … } envelope', () => {
    it('holds across every domain', async () => {
      const [user, peer] = await registerUsers(2);
      const { product } = await createProduct({ price_cents: 0 });
      const auth = bearer(user);

      // Auth — Session under `data`.
      const login = await api()
        .post(path('/auth/login'))
        .send({ email: user.email, password: user.password });
      expect(login.status).toBe(200);
      expect(Object.keys(expectData(login.body, 'POST /auth/login')).sort()).toEqual([
        'access_token',
        'refresh_token',
        'user_id',
      ]);

      // Social — User under `data`.
      const profile = await api().get(path(`/users/${peer.id}`)).set('Authorization', auth);
      expect(profile.status).toBe(200);
      const profileData = expectData(profile.body, 'GET /users/:id');
      expect(profileData.id).toBe(peer.id);
      expect(profileData.stats).toBeDefined();

      // Cursor page — items + next_cursor FLAT alongside the envelope.
      const followers = await api()
        .get(path(`/users/${peer.id}/followers`))
        .set('Authorization', auth);
      expect(followers.status).toBe(200);
      expectItems(followers.body, 'GET /users/:id/followers');
      expect(Object.keys(followers.body).sort()).toEqual([
        'items',
        'message',
        'next_cursor',
        'success',
      ]);

      // Non-paginated list — items only, no next_cursor.
      const search = await api()
        .get(path('/users/search'))
        .query({ q: peer.username })
        .set('Authorization', auth);
      expect(search.status).toBe(200);
      expectItems(search.body, 'GET /users/search');
      expect(Object.keys(search.body).sort()).toEqual(['items', 'message', 'success']);

      // Commerce.
      const products = await api().get(path('/products')).set('Authorization', auth);
      expectItems(products.body, 'GET /products');

      const cart = await api()
        .post(path('/cart/summary'))
        .set('Authorization', auth)
        .send({ items: [{ product_id: product.product_id, variant_id: null, quantity: 1 }] });
      expect(cart.status).toBe(200);
      expect(Object.keys(expectData(cart.body, 'POST /cart/summary')).sort()).toEqual([
        'currency',
        'item_count',
        'lines',
        'shipping',
        'subtotal',
        'tax',
        'total',
      ]);

      const orders = await api().get(path('/orders')).set('Authorization', auth);
      expectItems(orders.body, 'GET /orders');

      // Chat.
      const conversation = await api()
        .post(path(`/conversations/with/${peer.id}`))
        .set('Authorization', auth);
      expect(conversation.status).toBe(201);
      const conv = expectData(conversation.body, 'POST /conversations/with/:id');
      expect(conv.id).toBeDefined();

      const message = await api()
        .post(path(`/conversations/${conv.id as string}/messages`))
        .set('Authorization', auth)
        .send({ body: 'shape check' });
      expect(message.status).toBe(201);
      expectData(message.body, 'POST /conversations/:id/messages');

      // A collection WITH an extra top-level field (`typing`) — still flat.
      const messages = await api()
        .get(path(`/conversations/${conv.id as string}/messages`))
        .set('Authorization', auth);
      expectItems(messages.body, 'GET /conversations/:id/messages');
      expect(Object.keys(messages.body).sort()).toEqual([
        'items',
        'message',
        'success',
        'typing',
      ]);

      // Events.
      const event = await api()
        .post(path('/events'))
        .set('Authorization', auth)
        .send({
          title: 'Shape Check',
          description: 'Contract test.',
          starts_at: daysFromNow(3),
          ends_at: null,
          location_name: 'Somewhere',
          price_cents: 0,
          latitude: null,
          longitude: null,
        });
      expect(event.status).toBe(201);
      expect(expectData(event.body, 'POST /events').id).toBeDefined();

      const events = await api().get(path('/events')).set('Authorization', auth);
      expectItems(events.body, 'GET /events');

      // Calls.
      const calls = await api().get(path('/calls')).set('Authorization', auth);
      expect(calls.status).toBe(200);
      expectItems(calls.body, 'GET /calls');

      // Feed.
      const feed = await api().get(path('/feed/for-you')).set('Authorization', auth);
      expect(feed.status).toBe(200);
      expectItems(feed.body, 'GET /feed/for-you');
      expect(Object.keys(feed.body).sort()).toEqual([
        'items',
        'message',
        'next_cursor',
        'success',
      ]);
    });

    it('acknowledges toggle mutations with the envelope and no data', async () => {
      const [user, peer] = await registerUsers(2);
      const auth = bearer(user);

      const follow = await api()
        .post(path(`/users/${peer.id}/follow`))
        .set('Authorization', auth);
      expect(follow.status).toBe(200);
      expect(Object.keys(follow.body).sort()).toEqual(['message', 'success']);
      expect(follow.body.success).toBe(true);

      const unfollow = await api()
        .delete(path(`/users/${peer.id}/follow`))
        .set('Authorization', auth);
      expect(Object.keys(unfollow.body).sort()).toEqual(['message', 'success']);

      const device = await api()
        .post(path('/devices'))
        .set('Authorization', auth)
        .send({ token: 'fcm-token-for-contract-test', platform: 'ios' });
      expect(device.status).toBe(201);
      expect(Object.keys(device.body).sort()).toEqual(['message', 'success']);
    });

    it('uses snake_case for every key on the wire', async () => {
      const [user, peer] = await registerUsers(2);
      const auth = bearer(user);

      // Walk the whole body: a single camelCase key anywhere means a serializer
      // was missed. Cheaper and broader than naming fields one at a time.
      const camel = (value: unknown, trail = '$'): string[] => {
        if (Array.isArray(value)) {
          return value.flatMap((v, i) => camel(v, `${trail}[${i}]`));
        }
        if (value === null || typeof value !== 'object') return [];
        return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
          ...(/[a-z][A-Z]/.test(k) ? [`${trail}.${k}`] : []),
          ...camel(v, `${trail}.${k}`),
        ]);
      };

      const profile = await api().get(path(`/users/${peer.id}`)).set('Authorization', auth);
      expect(camel(profile.body)).toEqual([]);

      const feed = await api().get(path('/feed/for-you')).set('Authorization', auth);
      expect(camel(feed.body)).toEqual([]);

      const conversation = await api()
        .post(path(`/conversations/with/${peer.id}`))
        .set('Authorization', auth);
      expect(camel(conversation.body)).toEqual([]);
    });

    it('never leaks the password hash on any user-bearing shape', async () => {
      const [user, peer] = await registerUsers(2);
      const auth = bearer(user);

      const profile = await api().get(path(`/users/${peer.id}`)).set('Authorization', auth);
      const serialized = JSON.stringify(profile.body);

      expect(serialized).not.toMatch(/password/i);
      expect(serialized).not.toMatch(/\$2[aby]\$/); // a bcrypt hash prefix
      expect(profile.body.data.email).toBeUndefined(); // email is not part of UserSchema
    });
  });

  describe('error bodies carry { success: false, message, code }', () => {
    it('adds { errors } for a 400 and a specific code where the app branches', async () => {
      const unauthorized = await api().get(path('/orders'));
      expect(unauthorized.status).toBe(401);
      expect(Object.keys(unauthorized.body).sort()).toEqual(['code', 'message', 'success']);
      expect(unauthorized.body.success).toBe(false);
      expect(typeof unauthorized.body.message).toBe('string');
      expect(typeof unauthorized.body.code).toBe('string');

      const user = await registerUser();
      const notFound = await api()
        .get(path('/users/00000000-0000-4000-8000-000000000000'))
        .set('Authorization', bearer(user));
      expect(notFound.status).toBe(404);
      expect(Object.keys(notFound.body).sort()).toEqual(['code', 'message', 'success']);
      expect(notFound.body.code).toBe('NOT_FOUND');

      const invalid = await api().post(path('/auth/login')).send({ email: 'x', password: 'y' });
      expect(invalid.status).toBe(400);
      expect(Object.keys(invalid.body).sort()).toEqual([
        'code',
        'errors',
        'message',
        'success',
      ]);
      expect(invalid.body.code).toBe('VALIDATION_FAILED');
    });

    it('distinguishes a wrong password from an aged-out token by code', async () => {
      const user = await registerUser();

      // Wrong password → the app shows a form error and must NOT try a refresh.
      const wrongPassword = await api()
        .post(path('/auth/login'))
        .send({ email: user.email, password: 'not-the-password' });
      expect(wrongPassword.status).toBe(401);
      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');

      // A malformed token is unrecoverable → log out, don't refresh.
      const badToken = await api()
        .get(path('/orders'))
        .set('Authorization', 'Bearer not-a-jwt');
      expect(badToken.status).toBe(401);
      expect(badToken.body.code).toBe('SESSION_INVALID');
    });

    it('never includes a stack trace outside development', async () => {
      const res = await api().get(path('/orders'));

      expect(process.env.NODE_ENV).toBe('test');
      expect(res.body.stack).toBeUndefined();
    });
  });

  describe('integration gating — wired but disabled until the key is set', () => {
    it('503s media uploads while S3 is unconfigured', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/uploads/sign'))
        .set('Authorization', bearer(user))
        .send({ kind: 'video', content_type: 'video/mp4' });

      // 503 (not 500, not a silent success) so the client can tell "not wired
      // yet" apart from a client mistake or a crash. See INTEGRATIONS.md.
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.body.message).toMatch(/media storage is not configured/i);
      expect(res.body.message).toMatch(/S3_BUCKET/);
      // Retry-After lets the app show a countdown instead of a bare failure.
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('still validates the upload body BEFORE the gate', async () => {
      const user = await registerUser();
      const res = await api()
        .post(path('/uploads/sign'))
        .set('Authorization', bearer(user))
        .send({ kind: 'not-a-kind', content_type: 'video/mp4' });

      expect(res.status).toBe(400);
    });

    it('503s a priced checkout while Stripe is unconfigured', async () => {
      const user = await registerUser();
      const { product } = await createProduct({ price_cents: 4200 });

      const res = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(user))
        .send({ items: [{ product_id: product.product_id, variant_id: null, quantity: 1 }] });

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
        .send({ kind: 'video', content_type: 'video/mp4' });
      expect(upload.status).toBe(401);
    });
  });
});
