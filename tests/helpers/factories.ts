import { randomUUID } from 'crypto';
import Seller, { type SellerModel } from '@models/commerce/Seller';
import Product, { type ProductModel } from '@models/commerce/Product';
import ProductImage, { type ProductImageModel } from '@models/commerce/ProductImage';
import ProductVariant, { type ProductVariantModel } from '@models/commerce/ProductVariant';
import { api, path } from './app';

// Fixtures come in two flavours, on purpose:
//
//  - ACCOUNTS are created through the real POST /auth/signup, so every test user
//    carries a genuine device session + rotating refresh token. Minting JWTs
//    directly would sidestep `assertAccessSessionActive` and quietly make the
//    logout/refresh assertions meaningless.
//  - CATALOG rows (sellers/products) have no write endpoint — the app only reads
//    them — so they are inserted through the models.

export interface TestUser {
  id: string;
  username: string;
  email: string;
  password: string;
  access_token: string;
  refresh_token: string;
}

export const DEFAULT_PASSWORD = 'correct-horse-battery';

/** A fresh handle matching the username rule: /^[a-z0-9_.]+$/, 3–24 chars. */
export const uniqueUsername = (prefix = 'u'): string =>
  `${prefix}${randomUUID().replace(/-/g, '').slice(0, 14)}`;

export const registerUser = async (
  overrides: Partial<Pick<TestUser, 'username' | 'email' | 'password'>> = {}
): Promise<TestUser> => {
  const username = overrides.username ?? uniqueUsername();
  const email = overrides.email ?? `${username}@example.test`;
  const password = overrides.password ?? DEFAULT_PASSWORD;

  const res = await api()
    .post(path('/auth/signup'))
    .send({ username, email, password });

  if (res.status !== 201) {
    throw new Error(
      `registerUser: signup failed (${res.status}) ${JSON.stringify(res.body)}`
    );
  }

  // Signup returns the standard envelope; the Session lives under `data`.
  const session = res.body.data as {
    user_id: string;
    access_token: string;
    refresh_token: string;
  };

  return {
    id: session.user_id,
    username,
    email,
    password,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  };
};

const registerSerially = async (count: number): Promise<TestUser[]> => {
  // Serial, not Promise.all: each signup bcrypt-hashes a password, and a burst
  // of parallel signups just contends for the same pool connections.
  const users: TestUser[] = [];
  for (let i = 0; i < count; i += 1) users.push(await registerUser());
  return users;
};

/**
 * Register N users.
 *
 * The small arities return a fixed-length TUPLE rather than `TestUser[]`. Under
 * `noUncheckedIndexedAccess` an array index is `TestUser | undefined`, so
 * `const [alice, bob] = await registerUsers(2)` would otherwise hand every test
 * a possibly-undefined user and force a `!` at each of the dozens of call sites.
 * Fixing it here means the fixture boundary — the one place that actually knows
 * how many users were built — carries the guarantee, and it fails loudly with a
 * useful message if the count ever disagrees.
 */
export async function registerUsers(count: 1): Promise<[TestUser]>;
export async function registerUsers(count: 2): Promise<[TestUser, TestUser]>;
export async function registerUsers(count: 3): Promise<[TestUser, TestUser, TestUser]>;
export async function registerUsers(
  count: 4
): Promise<[TestUser, TestUser, TestUser, TestUser]>;
export async function registerUsers(count: number): Promise<TestUser[]>;
export async function registerUsers(count: number): Promise<TestUser[]> {
  const users = await registerSerially(count);
  if (users.length !== count) {
    throw new Error(
      `registerUsers(${count}): built ${users.length} users — a fixture is missing.`
    );
  }
  return users;
}

export const bearer = (user: TestUser | string): string =>
  `Bearer ${typeof user === 'string' ? user : user.access_token}`;

export interface ProductFixture {
  product: ProductModel;
  seller: SellerModel;
  images: ProductImageModel[];
  variants: ProductVariantModel[];
}

export interface ProductOptions {
  title?: string;
  description?: string;
  /** Integer minor units — the DB stores cents; the wire shows dollars. */
  price_cents?: number;
  stock?: number;
  image_urls?: string[];
  variants?: Array<{ name: string; price_delta_cents: number }>;
  seller?: SellerModel;
}

export const createSeller = (name = 'Test Seller'): Promise<SellerModel> =>
  Seller.create({ name, rating: 4.5 });

export const createProduct = async (
  options: ProductOptions = {}
): Promise<ProductFixture> => {
  const seller = options.seller ?? (await createSeller());
  const product = await Product.create({
    seller_id: seller.seller_id,
    title: options.title ?? 'Test Product',
    description: options.description ?? 'A product used by the test suite.',
    price_cents: options.price_cents ?? 6800,
    currency: 'USD',
    stock: options.stock ?? 25,
  });

  const image_urls = options.image_urls ?? [
    'https://cdn.example.test/a.jpg',
    'https://cdn.example.test/b.jpg',
  ];
  const images = await Promise.all(
    image_urls.map((url, position) =>
      ProductImage.create({ product_id: product.product_id, url, position })
    )
  );

  const variants = await Promise.all(
    (options.variants ?? []).map((v, position) =>
      ProductVariant.create({
        product_id: product.product_id,
        name: v.name,
        price_delta_cents: v.price_delta_cents,
        position,
      })
    )
  );

  return { product, seller, images, variants };
};

/** An ISO timestamp `days` in the future — event fixtures need a future start. */
export const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
