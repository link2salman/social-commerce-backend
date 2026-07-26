import { api, path } from '../helpers/app';
import { registerUser, bearer, type TestUser } from '../helpers/factories';

// End-to-end fulfillment against FREE products, so a paid/settled order exists
// without Stripe (which is env-gated off in tests). A $0 checkout settles
// immediately to payment_status 'succeeded', which is what a seller can fulfill.

const ADDRESS = {
  recipient_name: 'Ada Buyer',
  line1: '1 Test Street',
  line2: null,
  city: 'Testville',
  region: 'CA',
  postal_code: '90001',
  country: 'US',
};

const becomeSeller = (u: TestUser, name = 'Free Shop') =>
  api().post(path('/sellers')).set('Authorization', bearer(u)).send({ name });

const createFreeProduct = async (seller: TestUser): Promise<string> => {
  const res = await api()
    .post(path('/products'))
    .set('Authorization', bearer(seller))
    .send({ title: 'Freebie', price: 0, stock: 5 });
  if (res.status !== 201) throw new Error(`product create failed: ${res.status}`);
  return res.body.data.id as string;
};

const checkout = (buyer: TestUser, product_id: string, withAddress = true) =>
  api()
    .post(path('/orders/intent'))
    .set('Authorization', bearer(buyer))
    .send({
      items: [{ product_id, variant_id: null, quantity: 1 }],
      ...(withAddress ? { shipping_address: ADDRESS } : {}),
    });

interface Ctx {
  seller: TestUser;
  buyer: TestUser;
  product_id: string;
  orderId: string;
}
const setup = async (): Promise<Ctx> => {
  const seller = await registerUser();
  await becomeSeller(seller);
  const product_id = await createFreeProduct(seller);
  const buyer = await registerUser();
  const intent = await checkout(buyer, product_id);
  if (intent.status !== 201) throw new Error(`checkout failed: ${intent.status}`);
  return { seller, buyer, product_id, orderId: intent.body.data.order.id as string };
};

const sellerOrder = (seller: TestUser, id: string, action: 'fulfill' | 'deliver', body = {}) =>
  api()
    .post(path(`/sellers/me/orders/${id}/${action}`))
    .set('Authorization', bearer(seller))
    .send(body);

const orderDetail = (u: TestUser, id: string) =>
  api().get(path(`/orders/${id}`)).set('Authorization', bearer(u));

describe('order fulfillment', () => {
  it('collects the shipping address at checkout and starts unfulfilled', async () => {
    const { buyer, orderId } = await setup();
    const detail = await orderDetail(buyer, orderId);
    expect(detail.status).toBe(200);
    expect(detail.body.data.shipping_address).toEqual(ADDRESS);
    expect(detail.body.data.fulfillment).toEqual({
      status: 'unfulfilled',
      tracking_number: null,
      carrier: null,
      shipped_at: null,
      delivered_at: null,
    });
  });

  it('checkout still works without an address (optional)', async () => {
    const seller = await registerUser();
    await becomeSeller(seller);
    const product_id = await createFreeProduct(seller);
    const buyer = await registerUser();
    const res = await checkout(buyer, product_id, false);
    expect(res.status).toBe(201);
    const detail = await orderDetail(buyer, res.body.data.order.id);
    expect(detail.body.data.shipping_address).toBeNull();
  });

  it('shows the seller the order (buyer, their items, address)', async () => {
    const { seller, buyer, product_id, orderId } = await setup();
    const res = await api().get(path('/sellers/me/orders')).set('Authorization', bearer(seller));
    expect(res.status).toBe(200);
    const found = res.body.items.find((o: { id: string }) => o.id === orderId);
    expect(found).toBeTruthy();
    expect(found.buyer.id).toBe(buyer.id);
    expect(found.items.map((i: { product_id: string }) => i.product_id)).toContain(product_id);
    expect(found.shipping_address).toEqual(ADDRESS);
    expect(found.payment_status).toBe('succeeded');
  });

  it('drives unfulfilled → shipped → delivered, visible to the buyer', async () => {
    const { seller, buyer, orderId } = await setup();

    const ship = await sellerOrder(seller, orderId, 'fulfill', {
      tracking_number: '1Z999AA10123456784',
      carrier: 'UPS',
    });
    expect(ship.status).toBe(200);
    expect(ship.body.data.fulfillment).toMatchObject({
      status: 'shipped',
      tracking_number: '1Z999AA10123456784',
      carrier: 'UPS',
    });
    expect(ship.body.data.fulfillment.shipped_at).not.toBeNull();

    // The buyer sees it on their own order detail.
    const afterShip = await orderDetail(buyer, orderId);
    expect(afterShip.body.data.fulfillment.status).toBe('shipped');
    expect(afterShip.body.data.fulfillment.tracking_number).toBe('1Z999AA10123456784');

    const delivered = await sellerOrder(seller, orderId, 'deliver');
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.fulfillment.status).toBe('delivered');
    expect(delivered.body.data.fulfillment.delivered_at).not.toBeNull();
  });

  it('rejects delivering before shipping (409)', async () => {
    const { seller, orderId } = await setup();
    const res = await sellerOrder(seller, orderId, 'deliver');
    expect(res.status).toBe(409);
  });

  it('403s for a non-seller and for a seller with no product in the order', async () => {
    const { orderId } = await setup();

    const stranger = await registerUser();
    expect((await sellerOrder(stranger, orderId, 'fulfill')).status).toBe(403);

    const otherSeller = await registerUser();
    await becomeSeller(otherSeller, 'Other Shop');
    expect((await sellerOrder(otherSeller, orderId, 'fulfill')).status).toBe(403);

    // …and the unrelated seller doesn't see the order in their list.
    const list = await api().get(path('/sellers/me/orders')).set('Authorization', bearer(otherSeller));
    expect(list.body.items.find((o: { id: string }) => o.id === orderId)).toBeFalsy();
  });

  it('validates the fulfill body and requires auth', async () => {
    const { seller, orderId } = await setup();
    const tooLong = 'x'.repeat(121);
    expect((await sellerOrder(seller, orderId, 'fulfill', { tracking_number: tooLong })).status).toBe(400);
    expect((await api().post(path(`/sellers/me/orders/${orderId}/fulfill`))).status).toBe(401);
  });
});
