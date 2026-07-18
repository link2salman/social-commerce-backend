import { Op } from 'sequelize';
import { NotFoundError } from '@middlewares/error';
import Product from '@models/commerce/Product';
import Seller from '@models/commerce/Seller';
import ProductImage, { type ProductImageModel } from '@models/commerce/ProductImage';
import ProductVariant, { type ProductVariantModel } from '@models/commerce/ProductVariant';
import {
  serializeProduct,
  type ProductBundle,
  type ProductJSON,
} from '@serializers/productSerializer';

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

export const getProduct = async (productId: string): Promise<ProductJSON> => {
  const bundles = await loadProductBundles([productId]);
  const bundle = bundles.get(productId);
  if (!bundle) throw new NotFoundError('Product');
  return serializeProduct(bundle);
};
