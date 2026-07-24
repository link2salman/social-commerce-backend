import { api, path } from '../helpers/app';
import { registerUser, registerUsers, bearer, type TestUser } from '../helpers/factories';

const becomeSeller = (u: TestUser, name = 'Test Shop') =>
  api().post(path('/sellers')).set('Authorization', bearer(u)).send({ name });

interface ProductBody {
  title?: string;
  description?: string;
  price?: number;
  stock?: number;
  images?: string[];
  variants?: Array<{ name: string; priceDelta: number }>;
}
const create = (u: TestUser, body: ProductBody) =>
  api().post(path('/products')).set('Authorization', bearer(u)).send(body);

const VALID: ProductBody = {
  title: 'Handmade Mug',
  description: 'Stoneware, dishwasher safe',
  price: 24.99,
  stock: 10,
  images: ['https://cdn.example.test/mug-1.jpg', 'https://cdn.example.test/mug-2.jpg'],
  variants: [{ name: 'Blue', priceDelta: 0 }, { name: 'Gold rim', priceDelta: 5 }],
};

// A user who is a seller with one product; returns the product id.
const sellerWithProduct = async (): Promise<{ user: TestUser; productId: string }> => {
  const user = await registerUser();
  await becomeSeller(user);
  const res = await create(user, VALID);
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  return { user, productId: res.body.id as string };
};

describe('seller supply side', () => {
  describe('POST /sellers', () => {
    it('registers a seller and is idempotent-guarded (second attempt 409s)', async () => {
      const user = await registerUser();
      const res = await becomeSeller(user, 'Ava Ceramics');
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        name: 'Ava Ceramics',
        rating: expect.any(Number),
        isOwner: true,
      });

      const again = await becomeSeller(user, 'Ava Ceramics');
      expect(again.status).toBe(409);
    });

    it('400s on an empty shop name', async () => {
      const user = await registerUser();
      const res = await becomeSeller(user, '');
      expect(res.status).toBe(400);
    });

    it('GET /sellers/me 404s before registering, returns the profile after', async () => {
      const user = await registerUser();
      expect((await api().get(path('/sellers/me')).set('Authorization', bearer(user))).status).toBe(404);
      await becomeSeller(user);
      const me = await api().get(path('/sellers/me')).set('Authorization', bearer(user));
      expect(me.status).toBe(200);
      expect(me.body.isOwner).toBe(true);
    });
  });

  describe('POST /products', () => {
    it('lets a seller create a product and reads it back in the exact wire shape', async () => {
      const user = await registerUser();
      await becomeSeller(user, 'Mug Co');
      const res = await create(user, VALID);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        title: 'Handmade Mug',
        price: 24.99, // dollars on the wire, stored as cents
        stock: 10,
        images: [
          'https://cdn.example.test/mug-1.jpg',
          'https://cdn.example.test/mug-2.jpg',
        ],
        seller: { name: 'Mug Co', id: expect.any(String) },
        variants: [
          { name: 'Blue', priceDelta: 0, id: expect.any(String) },
          { name: 'Gold rim', priceDelta: 5, id: expect.any(String) },
        ],
      });

      // Visible through the public read endpoints too.
      const id = res.body.id as string;
      const detail = await api().get(path(`/products/${id}`)).set('Authorization', bearer(user));
      expect(detail.status).toBe(200);
      expect(detail.body.price).toBe(24.99);

      const list = await api().get(path('/products')).set('Authorization', bearer(user));
      expect(list.body.items.map((p: { id: string }) => p.id)).toContain(id);
    });

    it('403s when the caller is not a seller', async () => {
      const user = await registerUser();
      const res = await create(user, VALID);
      expect(res.status).toBe(403);
    });

    it('400s on invalid input (negative price, missing title)', async () => {
      const user = await registerUser();
      await becomeSeller(user);
      expect((await create(user, { ...VALID, price: -1 })).status).toBe(400);
      expect((await create(user, { ...VALID, title: '' })).status).toBe(400);
    });

    it('401s without auth', async () => {
      const res = await api().post(path('/products')).send(VALID);
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /products/:id', () => {
    it('lets the owner update fields and replace variants', async () => {
      const { user, productId } = await sellerWithProduct();
      const res = await api()
        .patch(path(`/products/${productId}`))
        .set('Authorization', bearer(user))
        .send({ price: 19.5, stock: 3, variants: [{ name: 'Only', priceDelta: 2 }] });

      expect(res.status).toBe(200);
      expect(res.body.price).toBe(19.5);
      expect(res.body.stock).toBe(3);
      expect(res.body.variants).toEqual([
        { id: expect.any(String), name: 'Only', priceDelta: 2 },
      ]);
    });

    it("403s when a different user tries to edit someone else's product", async () => {
      const { productId } = await sellerWithProduct();
      const intruder = await registerUser();
      await becomeSeller(intruder); // even a seller can't edit another's product
      const res = await api()
        .patch(path(`/products/${productId}`))
        .set('Authorization', bearer(intruder))
        .send({ price: 1 });
      expect(res.status).toBe(403);
    });

    it('400s on an empty patch', async () => {
      const { user, productId } = await sellerWithProduct();
      const res = await api()
        .patch(path(`/products/${productId}`))
        .set('Authorization', bearer(user))
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /products/:id', () => {
    it('lets the owner soft-delete; it then vanishes from reads', async () => {
      const { user, productId } = await sellerWithProduct();
      const del = await api().delete(path(`/products/${productId}`)).set('Authorization', bearer(user));
      expect(del.status).toBe(200);

      expect((await api().get(path(`/products/${productId}`)).set('Authorization', bearer(user))).status).toBe(404);
      const list = await api().get(path('/products')).set('Authorization', bearer(user));
      expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(productId);
    });

    it("403s for a non-owner", async () => {
      const { productId } = await sellerWithProduct();
      const [intruder] = await registerUsers(1);
      const res = await api().delete(path(`/products/${productId}`)).set('Authorization', bearer(intruder));
      expect(res.status).toBe(403);
    });
  });

  describe('GET /sellers/me/products', () => {
    it("returns only the caller's own catalog", async () => {
      const { user, productId } = await sellerWithProduct();
      const res = await api().get(path('/sellers/me/products')).set('Authorization', bearer(user));
      expect(res.status).toBe(200);
      const ids = res.body.items.map((p: { id: string }) => p.id);
      expect(ids).toContain(productId);
      // A different seller's product is not listed.
      const other = await sellerWithProduct();
      expect(ids).not.toContain(other.productId);
    });

    it('returns an empty list for a user who is not a seller', async () => {
      const user = await registerUser();
      const res = await api().get(path('/sellers/me/products')).set('Authorization', bearer(user));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });
  });
});
