import { Op, fn, col, where } from 'sequelize';
import { sequelize } from '@config/db';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '@middlewares/error';
import Product, { type ProductModel } from '@models/commerce/Product';
import Seller, { type SellerModel } from '@models/commerce/Seller';
import ProductImage, { type ProductImageModel } from '@models/commerce/ProductImage';
import ProductVariant, { type ProductVariantModel } from '@models/commerce/ProductVariant';
import { majorToCents } from '@utils/money';
import {
  serializeProduct,
  type ProductBundle,
  type ProductJSON,
} from '@serializers/productSerializer';
import type {
  CreateProductBody,
  UpdateProductBody,
} from '@validators/productValidators';

// Batch-load full product bundles (product + seller + images + variants) for a
// set of ids — a fixed number of queries, no N+1. Reused by the product list,
// single-product view, cart pricing, and feed product-tag hydration.
export const loadProductBundles = async (
  productIds: string[]
): Promise<Map<string, ProductBundle>> => {
  const result = new Map<string, ProductBundle>();
  if (productIds.length === 0) return result;

  const products = await Product.findAll({
    where: { product_id: { [Op.in]: productIds } },
  });
  if (products.length === 0) return result;

  const sellerIds = [...new Set(products.map(p => p.seller_id))];
  const [sellers, images, variants] = await Promise.all([
    Seller.findAll({ where: { seller_id: { [Op.in]: sellerIds } } }),
    ProductImage.findAll({
      where: { product_id: { [Op.in]: productIds } },
    }),
    ProductVariant.findAll({
      where: { product_id: { [Op.in]: productIds } },
    }),
  ]);

  const sellerById = new Map(sellers.map(s => [s.seller_id, s]));
  const imagesByProduct = new Map<string, ProductImageModel[]>();
  for (const img of images) {
    const arr = imagesByProduct.get(img.product_id) ?? [];
    arr.push(img);
    imagesByProduct.set(img.product_id, arr);
  }
  const variantsByProduct = new Map<string, ProductVariantModel[]>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push(v);
    variantsByProduct.set(v.product_id, arr);
  }

  for (const product of products) {
    const seller = sellerById.get(product.seller_id);
    if (!seller) continue;
    result.set(product.product_id, {
      product,
      seller,
      images: imagesByProduct.get(product.product_id) ?? [],
      variants: variantsByProduct.get(product.product_id) ?? [],
    });
  }
  return result;
};

export const listProducts = async (): Promise<{ items: ProductJSON[] }> => {
  const products = await Product.findAll({ order: [['created_at', 'ASC']] });
  const bundles = await loadProductBundles(products.map(p => p.product_id));
  const items = products
    .map(p => bundles.get(p.product_id))
    .filter((b): b is ProductBundle => Boolean(b))
    .map(serializeProduct);
  return { items };
};

// Product discovery search — case-insensitive substring over title/description,
// served by the pg_trgm indexes (see migration 20260723000000). Newest-first,
// capped. Empty query returns nothing (same contract as people search).
export const searchProducts = async (
  query: string
): Promise<{ items: ProductJSON[] }> => {
  const q = query.trim().toLowerCase();
  if (!q) return { items: [] };
  const like = `%${q}%`;

  const matches = await Product.findAll({
    where: {
      [Op.or]: [
        where(fn('lower', col('title')), { [Op.like]: like }),
        where(fn('lower', col('description')), { [Op.like]: like }),
      ],
    },
    order: [['created_at', 'DESC']],
    limit: 20,
  });

  const bundles = await loadProductBundles(matches.map(p => p.product_id));
  const items = matches
    .map(p => bundles.get(p.product_id))
    .filter((b): b is ProductBundle => Boolean(b))
    .map(serializeProduct);
  return { items };
};

export const getProduct = async (productId: string): Promise<ProductJSON> => {
  const bundles = await loadProductBundles([productId]);
  const bundle = bundles.get(productId);
  if (!bundle) throw new NotFoundError('Product');
  return serializeProduct(bundle);
};

// ── Seller supply side ───────────────────────────────────────────────────────
// A user registers as a seller (one profile per user), then CRUDs their own
// products. Prices arrive as dollars on the wire and convert to integer cents
// here; every write returns the exact ProductJSON the read endpoints serve.

export const getSellerForUser = (userId: string): Promise<SellerModel | null> =>
  Seller.findOne({ where: { user_id: userId } });

export const registerSeller = async (
  userId: string,
  name: string
): Promise<SellerModel> => {
  const existing = await getSellerForUser(userId);
  if (existing) throw new ConflictError('You already have a seller profile');
  return Seller.create({ user_id: userId, name });
};

const requireSellerForUser = async (userId: string): Promise<SellerModel> => {
  const seller = await getSellerForUser(userId);
  if (!seller) {
    throw new ForbiddenError('Create a seller profile before adding products');
  }
  return seller;
};

// A product's owner is the user linked to its seller. Platform-owned seed
// products (seller.user_id null) have no user owner, so nobody can edit them.
const assertOwnsProduct = async (
  userId: string,
  product: ProductModel
): Promise<void> => {
  const seller = await Seller.findByPk(product.seller_id);
  if (!seller || seller.user_id !== userId) {
    throw new ForbiddenError('This product belongs to another seller');
  }
};

const buildImageRows = (productId: string, urls: string[]) =>
  urls.map((url, position) => ({ product_id: productId, url, position }));

const buildVariantRows = (
  productId: string,
  variants: Array<{ name: string; priceDelta: number }>
) =>
  variants.map((v, position) => ({
    product_id: productId,
    name: v.name,
    price_delta_cents: majorToCents(v.priceDelta),
    position,
  }));

export const createProductForUser = async (
  userId: string,
  input: CreateProductBody
): Promise<ProductJSON> => {
  const seller = await requireSellerForUser(userId);

  const productId = await sequelize.transaction(async transaction => {
    const product = await Product.create(
      {
        seller_id: seller.seller_id,
        title: input.title,
        description: input.description,
        price_cents: majorToCents(input.price),
        currency: input.currency,
        stock: input.stock,
      },
      { transaction }
    );
    if (input.images.length) {
      await ProductImage.bulkCreate(
        buildImageRows(product.product_id, input.images),
        { transaction }
      );
    }
    if (input.variants.length) {
      await ProductVariant.bulkCreate(
        buildVariantRows(product.product_id, input.variants),
        { transaction }
      );
    }
    return product.product_id;
  });

  return getProduct(productId);
};

export const updateProductForUser = async (
  userId: string,
  productId: string,
  input: UpdateProductBody
): Promise<ProductJSON> => {
  const product = await Product.findByPk(productId);
  if (!product) throw new NotFoundError('Product');
  await assertOwnsProduct(userId, product);

  await sequelize.transaction(async transaction => {
    const patch: Partial<{
      title: string;
      description: string;
      price_cents: number;
      currency: string;
      stock: number;
    }> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.price !== undefined) patch.price_cents = majorToCents(input.price);
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.stock !== undefined) patch.stock = input.stock;
    if (Object.keys(patch).length) {
      await product.update(patch, { transaction });
    }

    // images/variants, when supplied, REPLACE the existing set. Historical
    // orders are unaffected — order_items snapshot title/variant/price at
    // purchase, and the variant FK is ON DELETE SET NULL.
    if (input.images !== undefined) {
      await ProductImage.destroy({ where: { product_id: productId }, transaction });
      if (input.images.length) {
        await ProductImage.bulkCreate(buildImageRows(productId, input.images), {
          transaction,
        });
      }
    }
    if (input.variants !== undefined) {
      await ProductVariant.destroy({ where: { product_id: productId }, transaction });
      if (input.variants.length) {
        await ProductVariant.bulkCreate(
          buildVariantRows(productId, input.variants),
          { transaction }
        );
      }
    }
  });

  return getProduct(productId);
};

export const deleteProductForUser = async (
  userId: string,
  productId: string
): Promise<void> => {
  const product = await Product.findByPk(productId);
  if (!product) throw new NotFoundError('Product');
  await assertOwnsProduct(userId, product);
  await product.destroy(); // paranoid soft-delete — vanishes from reads
};

export const listMyProducts = async (
  userId: string
): Promise<{ items: ProductJSON[] }> => {
  const seller = await getSellerForUser(userId);
  if (!seller) return { items: [] };
  const products = await Product.findAll({
    where: { seller_id: seller.seller_id },
    order: [['created_at', 'DESC']],
  });
  const bundles = await loadProductBundles(products.map(p => p.product_id));
  const items = products
    .map(p => bundles.get(p.product_id))
    .filter((b): b is ProductBundle => Boolean(b))
    .map(serializeProduct);
  return { items };
};
