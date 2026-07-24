import { api, path } from '../helpers/app';
import { registerUser, bearer, type TestUser } from '../helpers/factories';

// End-to-end fulfillment against FREE products, so a paid/settled order exists
// without Stripe (which is env-gated off in tests). A $0 checkout settles
// immediately to payment_status 'succeeded', which is what a seller can fulfill.

const ADDRESS = {
  recipientName: 'Ada Buyer',
  line1: '1 Test Street',
  line2: null,
  city: 'Testville',
  region: 'CA',
  postalCode: '90001',
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
  return res.body.id as string;
};

const checkout = (buyer: TestUser, productId: string, withAddress = true) =>
  api()
    .post(path('/orders/intent'))
    .set('Authorization', bearer(buyer))
    .send({
      items: [{ productId, variantId: null, quantity: 1 }],
      ...(withAddress ? { shippingAddress: ADDRESS } : {}),
    });

interface Ctx {
  seller: TestUser;
  buyer: TestUser;
  productId: string;
  orderId: string;
}
const setup = async (): Promise<Ctx> => {
  const seller = await registerUser();
  await becomeSeller(seller);
  const productId = await createFreeProduct(seller);
  const buyer = await registerUser();
  const intent = await checkout(buyer, productId);
  if (intent.status !== 201) throw new Error(`checkout failed: ${intent.status}`);
  return { seller, buyer, productId, orderId: intent.body.order.id as string };
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
    expect(detail.body.shippingAddress).toEqual(ADDRESS);
    expect(detail.body.fulfillment).toEqual({
      status: 'unfulfilled',
      trackingNumber: null,
      carrier: null,
      shippedAt: null,
      deliveredAt: null,
    });
  });

  it('checkout still works without an address (optional)', async () => {
    const seller = await registerUser();
    await becomeSeller(seller);
    const productId = await createFreeProduct(seller);
    const buyer = await registerUser();
    const res = await checkout(buyer, productId, false);
    expect(res.status).toBe(201);
    const detail = await orderDetail(buyer, res.body.order.id);
    expect(detail.body.shippingAddress).toBeNull();
  });

  it('shows the seller the order (buyer, their items, address)', async () => {
    const { seller, buyer, productId, orderId } = await setup();
    const res = await api().get(path('/sellers/me/orders')).set('Authorization', bearer(seller));
    expect(res.status).toBe(200);
    const found = res.body.items.find((o: { id: string }) => o.id === orderId);
    expect(found).toBeTruthy();
    expect(found.buyer.id).toBe(buyer.id);
    expect(found.items.map((i: { productId: string }) => i.productId)).toContain(productId);
    expect(found.shippingAddress).toEqual(ADDRESS);
    expect(found.paymentStatus).toBe('succeeded');
  });

  it('drives unfulfilled → shipped → delivered, visible to the buyer', async () => {
    const { seller, buyer, orderId } = await setup();

    const ship = await sellerOrder(seller, orderId, 'fulfill', {
      trackingNumber: '1Z999AA10123456784',
      carrier: 'UPS',
    });
    expect(ship.status).toBe(200);
    expect(ship.body.fulfillment).toMatchObject({
      status: 'shipped',
      trackingNumber: '1Z999AA10123456784',
      carrier: 'UPS',
    });
    expect(ship.body.fulfillment.shippedAt).not.toBeNull();

    // The buyer sees it on their own order detail.
    const afterShip = await orderDetail(buyer, orderId);
    expect(afterShip.body.fulfillment.status).toBe('shipped');
    expect(afterShip.body.fulfillment.trackingNumber).toBe('1Z999AA10123456784');

    const delivered = await sellerOrder(seller, orderId, 'deliver');
    expect(delivered.status).toBe(200);
    expect(delivered.body.fulfillment.status).toBe('delivered');
    expect(delivered.body.fulfillment.deliveredAt).not.toBeNull();
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
    expect((await sellerOrder(seller, orderId, 'fulfill', { trackingNumber: tooLong })).status).toBe(400);
    expect((await api().post(path(`/sellers/me/orders/${orderId}/fulfill`))).status).toBe(401);
  });
});
