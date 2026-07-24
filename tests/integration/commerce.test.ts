import { api, path } from '../helpers/app';
import { registerUser, registerUsers, bearer, createProduct } from '../helpers/factories';
import Order from '@models/commerce/Order';
import OrderItem from '@models/commerce/OrderItem';
import Product from '@models/commerce/Product';
import User from '@models/user/User';

// pricingService replicates the app's mock arithmetic byte-for-byte: flat $6.99
// shipping over any non-empty cart, 8% tax, 2-dp rounding at every step. These
// numbers are the contract — the client renders them directly.
const FLAT_SHIPPING = 6.99;

describe('commerce', () => {
  describe('GET /products', () => {
    it('returns products with money in MAJOR units (dollars), not cents', async () => {
      const viewer = await registerUser();
      const { product, seller } = await createProduct({
        title: 'Linen Shirt',
        description: 'Breathable.',
        priceCents: 6800,
        stock: 12,
        imageUrls: ['https://cdn.example.test/1.jpg', 'https://cdn.example.test/2.jpg'],
        variants: [
          { name: 'Small', priceDeltaCents: 0 },
          { name: 'Large', priceDeltaCents: 500 },
        ],
      });

      const res = await api().get(path('/products')).set('Authorization', bearer(viewer));

      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['items']);
      const item = res.body.items.find((p: { id: string }) => p.id === product.product_id);
      expect(item).toEqual({
        id: product.product_id,
        title: 'Linen Shirt',
        description: 'Breathable.',
        price: 68, // 6800 cents → 68 dollars
        currency: 'USD',
        images: ['https://cdn.example.test/1.jpg', 'https://cdn.example.test/2.jpg'],
        seller: { id: seller.seller_id, name: seller.name, rating: seller.rating },
        stock: 12,
        variants: [
          { id: expect.any(String), name: 'Small', priceDelta: 0 },
          { id: expect.any(String), name: 'Large', priceDelta: 5 },
        ],
      });
    });

    it('orders images and variants by position', async () => {
      const viewer = await registerUser();
      const { product } = await createProduct({
        imageUrls: ['https://cdn.example.test/first.jpg', 'https://cdn.example.test/second.jpg'],
        variants: [
          { name: 'A', priceDeltaCents: 0 },
          { name: 'B', priceDeltaCents: 100 },
          { name: 'C', priceDeltaCents: 200 },
        ],
      });

      const res = await api()
        .get(path(`/products/${product.product_id}`))
        .set('Authorization', bearer(viewer));

      expect(res.status).toBe(200);
      expect(res.body.images).toEqual([
        'https://cdn.example.test/first.jpg',
        'https://cdn.example.test/second.jpg',
      ]);
      expect(res.body.variants.map((v: { name: string }) => v.name)).toEqual(['A', 'B', 'C']);
    });

    it('404s for an unknown product id', async () => {
      const viewer = await registerUser();
      const res = await api()
        .get(path('/products/00000000-0000-4000-8000-000000000000'))
        .set('Authorization', bearer(viewer));

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Product not found');
    });

    it('requires auth', async () => {
      const res = await api().get(path('/products'));
      expect(res.status).toBe(401);
    });
  });

  describe('POST /cart/summary', () => {
    it('computes subtotal, flat shipping, 8% tax and total', async () => {
      const viewer = await registerUser();
      const { product } = await createProduct({ title: 'Chair', priceCents: 6800 });

      const res = await api()
        .post(path('/cart/summary'))
        .set('Authorization', bearer(viewer))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 2 }] });

      expect(res.status).toBe(200);
      // 68.00 × 2 = 136.00 · +6.99 shipping · +10.88 tax (8%) = 153.87
      expect(res.body).toEqual({
        lines: [
          {
            productId: product.product_id,
            variantId: null,
            title: 'Chair',
            variantName: null,
            imageUrl: 'https://cdn.example.test/a.jpg',
            unitPrice: 68,
            quantity: 2,
            lineTotal: 136,
          },
        ],
        currency: 'USD',
        itemCount: 2,
        subtotal: 136,
        shipping: FLAT_SHIPPING,
        tax: 10.88,
        total: 153.87,
      });
    });

    it('adds the variant price delta to the unit price', async () => {
      const viewer = await registerUser();
      const { product, variants } = await createProduct({
        title: 'Mug',
        priceCents: 1999,
        variants: [{ name: 'Large', priceDeltaCents: 500 }],
      });

      const res = await api()
        .post(path('/cart/summary'))
        .set('Authorization', bearer(viewer))
        .send({
          items: [
            { productId: product.product_id, variantId: variants[0]!.variant_id, quantity: 3 },
          ],
        });

      expect(res.status).toBe(200);
      // (19.99 + 5.00) × 3 = 74.97 · tax 6.00 (round2 of 5.9976) · +6.99 = 87.96
      expect(res.body.lines[0]).toMatchObject({
        variantId: variants[0]!.variant_id,
        variantName: 'Large',
        unitPrice: 24.99,
        quantity: 3,
        lineTotal: 74.97,
      });
      expect(res.body.subtotal).toBe(74.97);
      expect(res.body.tax).toBe(6);
      expect(res.body.total).toBe(87.96);
    });

    it('sums multiple lines and reports itemCount as total units', async () => {
      const viewer = await registerUser();
      const first = await createProduct({ title: 'One', priceCents: 1050 });
      const second = await createProduct({ title: 'Two', priceCents: 2575 });

      const res = await api()
        .post(path('/cart/summary'))
        .set('Authorization', bearer(viewer))
        .send({
          items: [
            { productId: first.product.product_id, variantId: null, quantity: 2 },
            { productId: second.product.product_id, variantId: null, quantity: 1 },
          ],
        });

      expect(res.status).toBe(200);
      // 10.50×2 = 21.00, 25.75×1 = 25.75 → subtotal 46.75, tax 3.74, total 57.48
      expect(res.body.itemCount).toBe(3);
      expect(res.body.subtotal).toBe(46.75);
      expect(res.body.tax).toBe(3.74);
      expect(res.body.total).toBe(57.48);
    });

    it('charges NO shipping on an empty cart', async () => {
      const viewer = await registerUser();
      const res = await api()
        .post(path('/cart/summary'))
        .set('Authorization', bearer(viewer))
        .send({ items: [] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        lines: [],
        currency: 'USD',
        itemCount: 0,
        subtotal: 0,
        shipping: 0,
        tax: 0,
        total: 0,
      });
    });

    it('404s when a cart references a product that does not exist', async () => {
      const viewer = await registerUser();
      const res = await api()
        .post(path('/cart/summary'))
        .set('Authorization', bearer(viewer))
        .send({
          items: [
            {
              productId: '00000000-0000-4000-8000-000000000000',
              variantId: null,
              quantity: 1,
            },
          ],
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Product not found');
    });

    it.each([
      ['a zero quantity', { productId: '00000000-0000-4000-8000-000000000000', variantId: null, quantity: 0 }],
      ['a fractional quantity', { productId: '00000000-0000-4000-8000-000000000000', variantId: null, quantity: 1.5 }],
      ['a non-uuid productId', { productId: 'nope', variantId: null, quantity: 1 }],
    ])('400s on %s', async (_label, item) => {
      const viewer = await registerUser();
      const res = await api()
        .post(path('/cart/summary'))
        .set('Authorization', bearer(viewer))
        .send({ items: [item] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });
  });

  describe('checkout intent → confirm', () => {
    it('settles a $0 order server-side with provider "none" and no payment sheet', async () => {
      const viewer = await registerUser();
      const { product } = await createProduct({ title: 'Freebie', priceCents: 0 });

      const intent = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(viewer))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 1 }] });

      expect(intent.status).toBe(201);
      expect(intent.body).toEqual({
        order: {
          id: expect.any(String),
          status: 'confirmed', // settled immediately — nothing to charge
          currency: 'USD',
          total: 0,
          lineCount: 1,
          createdAt: expect.any(String),
        },
        provider: 'none',
        clientSecret: null,
        publishableKey: null,
        amount: 0,
        currency: 'USD',
      });

      // The order + its lines were persisted atomically.
      const orderId = intent.body.order.id;
      const stored = await Order.findByPk(orderId);
      expect(stored!.user_id).toBe(viewer.id);
      expect(stored!.payment_status).toBe('succeeded');
      expect(await OrderItem.count({ where: { order_id: orderId } })).toBe(1);

      // Confirm is idempotent for an already-settled order.
      const confirmed = await api()
        .post(path(`/orders/${orderId}/confirm`))
        .set('Authorization', bearer(viewer));
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe('confirmed');
      expect(confirmed.body.id).toBe(orderId);
    });

    it('400s when the intent has no items', async () => {
      const viewer = await registerUser();
      const res = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(viewer))
        .send({ items: [] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Validation failed');
    });
  });

  describe('checkout integrity', () => {
    it('enforces stock — an over-quantity checkout 409s and touches nothing', async () => {
      const viewer = await registerUser();
      const { product } = await createProduct({ title: 'Last One', priceCents: 0, stock: 1 });

      const res = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(viewer))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 2 }] });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/out of stock/i);

      // The failed checkout is a full no-op: no order, stock untouched.
      expect(await Order.count({ where: { user_id: viewer.id } })).toBe(0);
      const reread = await Product.findByPk(product.product_id);
      expect(reread!.stock).toBe(1);
    });

    it('decrements stock atomically on a successful checkout', async () => {
      const viewer = await registerUser();
      const { product } = await createProduct({ title: 'In Stock', priceCents: 0, stock: 5 });

      const res = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(viewer))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 2 }] });
      expect(res.status).toBe(201);

      const reread = await Product.findByPk(product.product_id);
      expect(reread!.stock).toBe(3);
    });

    it('leaves NO orphan order when Stripe is unconfigured (priced checkout 503s)', async () => {
      // A priced order needs Stripe, which is env-gated off in the test env, so
      // this 503s. The order + its lines must be rolled back and stock restored
      // — a gated checkout must not leave an unpayable order in GET /orders.
      const viewer = await registerUser();
      const { product } = await createProduct({ title: 'Priced', priceCents: 6800, stock: 4 });

      const res = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(viewer))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 1 }] });

      expect(res.status).toBe(503);
      expect(await Order.count({ where: { user_id: viewer.id } })).toBe(0);
      const reread = await Product.findByPk(product.product_id);
      expect(reread!.stock).toBe(4); // stock restored by the compensating rollback
    });
  });

  describe('admin refund (POST /admin/orders/:id/refund)', () => {
    // A $0 order settles to 'succeeded' with no PaymentIntent, so it can be
    // refunded end-to-end without touching Stripe.
    const settledOrder = async (): Promise<{ orderId: string; buyer: Awaited<ReturnType<typeof registerUser>> }> => {
      const buyer = await registerUser();
      const { product } = await createProduct({ title: 'Refundable', priceCents: 0, stock: 3 });
      const intent = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(buyer))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 1 }] });
      return { orderId: intent.body.order.id as string, buyer };
    };

    it('lets a moderator refund a settled order (idempotently)', async () => {
      const { orderId } = await settledOrder();
      const admin = await registerUser();
      await User.update({ is_admin: true }, { where: { user_id: admin.id } });

      const refund = await api()
        .post(path(`/admin/orders/${orderId}/refund`))
        .set('Authorization', bearer(admin));
      expect(refund.status).toBe(200);
      expect(refund.body.id).toBe(orderId);

      const order = await Order.findByPk(orderId);
      expect(order!.payment_status).toBe('refunded');
      expect(order!.refunded_at).not.toBeNull();

      // Second refund is a no-op that still 200s (idempotent).
      const again = await api()
        .post(path(`/admin/orders/${orderId}/refund`))
        .set('Authorization', bearer(admin));
      expect(again.status).toBe(200);
    });

    it('403s for a non-moderator and 401s for an anonymous caller', async () => {
      const { orderId, buyer } = await settledOrder();

      const asUser = await api()
        .post(path(`/admin/orders/${orderId}/refund`))
        .set('Authorization', bearer(buyer));
      expect(asUser.status).toBe(403);

      const anon = await api().post(path(`/admin/orders/${orderId}/refund`));
      expect(anon.status).toBe(401);

      // Neither attempt refunded the order.
      const order = await Order.findByPk(orderId);
      expect(order!.payment_status).toBe('succeeded');
    });
  });

  describe('GET /orders and GET /orders/:id', () => {
    it('lists the caller\'s orders newest-first and returns the full detail shape', async () => {
      const viewer = await registerUser();
      const { product } = await createProduct({ title: 'Gratis', priceCents: 0 });

      const first = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(viewer))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 1 }] });
      const second = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(viewer))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 2 }] });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const list = await api().get(path('/orders')).set('Authorization', bearer(viewer));
      expect(list.status).toBe(200);
      expect(Object.keys(list.body)).toEqual(['items']);
      expect(list.body.items).toHaveLength(2);
      for (const order of list.body.items) {
        expect(Object.keys(order).sort()).toEqual([
          'createdAt',
          'currency',
          'id',
          'lineCount',
          'status',
          'total',
        ]);
      }

      const detail = await api()
        .get(path(`/orders/${second.body.order.id}`))
        .set('Authorization', bearer(viewer));
      expect(detail.status).toBe(200);
      // OrderDetail = Order + lines + the money breakdown.
      expect(detail.body).toEqual({
        id: second.body.order.id,
        status: 'confirmed',
        currency: 'USD',
        total: 0,
        lineCount: 1,
        createdAt: expect.any(String),
        subtotal: 0,
        shipping: 0,
        tax: 0,
        // No address supplied at this checkout; fulfillment starts fresh.
        shippingAddress: null,
        fulfillment: {
          status: 'unfulfilled',
          trackingNumber: null,
          carrier: null,
          shippedAt: null,
          deliveredAt: null,
        },
        lines: [
          {
            productId: product.product_id,
            variantId: null,
            title: 'Gratis',
            variantName: null,
            imageUrl: expect.any(String),
            unitPrice: 0,
            quantity: 2,
            lineTotal: 0,
          },
        ],
      });
    });

    it('returns an empty list for a user with no orders', async () => {
      const viewer = await registerUser();
      const res = await api().get(path('/orders')).set('Authorization', bearer(viewer));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });

    it('ENFORCES ownership — another user cannot read or confirm the order', async () => {
      const [owner, intruder] = await registerUsers(2);
      const { product } = await createProduct({ priceCents: 0 });

      const created = await api()
        .post(path('/orders/intent'))
        .set('Authorization', bearer(owner))
        .send({ items: [{ productId: product.product_id, variantId: null, quantity: 1 }] });
      const orderId = created.body.order.id;

      // The owner can read it…
      const mine = await api()
        .get(path(`/orders/${orderId}`))
        .set('Authorization', bearer(owner));
      expect(mine.status).toBe(200);

      // …a different signed-in user cannot. 404, not 403: the existence of
      // someone else's order is not disclosed.
      const theirs = await api()
        .get(path(`/orders/${orderId}`))
        .set('Authorization', bearer(intruder));
      expect(theirs.status).toBe(404);
      expect(theirs.body.message).toBe('Order not found');

      // …and cannot confirm it either.
      const confirm = await api()
        .post(path(`/orders/${orderId}/confirm`))
        .set('Authorization', bearer(intruder));
      expect(confirm.status).toBe(404);

      // The intruder's own order list stays empty.
      const list = await api().get(path('/orders')).set('Authorization', bearer(intruder));
      expect(list.body.items).toHaveLength(0);
    });

    it('404s for an order id that does not exist', async () => {
      const viewer = await registerUser();
      const res = await api()
        .get(path('/orders/00000000-0000-4000-8000-000000000000'))
        .set('Authorization', bearer(viewer));

      expect(res.status).toBe(404);
    });

    it('requires auth on every order route', async () => {
      const list = await api().get(path('/orders'));
      const detail = await api().get(path('/orders/00000000-0000-4000-8000-000000000000'));
      const intent = await api().post(path('/orders/intent')).send({ items: [] });

      expect(list.status).toBe(401);
      expect(detail.status).toBe(401);
      expect(intent.status).toBe(401);
    });
  });
});
