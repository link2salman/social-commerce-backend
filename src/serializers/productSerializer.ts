import type { ProductModel } from '@models/commerce/Product';
import type { ProductVariantModel } from '@models/commerce/ProductVariant';
import type { ProductImageModel } from '@models/commerce/ProductImage';
import type { SellerModel } from '@models/commerce/Seller';
import { centsToMajor } from '@utils/money';
import type { ProductTagJSON } from '@serializers/videoSerializer';

// The client's product.schema.ts — money is MAJOR-unit dollars on the wire.
export interface ProductJSON {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  images: string[];
  seller: { id: string; name: string; rating: number };
  stock: number;
  variants: Array<{ id: string; name: string; priceDelta: number }>;
}

export interface ProductBundle {
  product: ProductModel;
  seller: SellerModel;
  images: ProductImageModel[];
  variants: ProductVariantModel[];
}

export const serializeProduct = (b: ProductBundle): ProductJSON => ({
  id: b.product.product_id,
  title: b.product.title,
  description: b.product.description,
  price: centsToMajor(b.product.price_cents),
  currency: b.product.currency,
  images: [...b.images]
    .sort((a, z) => a.position - z.position)
    .map(i => i.url),
  seller: {
    id: b.seller.seller_id,
    name: b.seller.name,
    rating: b.seller.rating,
  },
  stock: b.product.stock,
  variants: [...b.variants]
    .sort((a, z) => a.position - z.position)
    .map(v => ({
      id: v.variant_id,
      name: v.name,
      priceDelta: centsToMajor(v.price_delta_cents),
    })),
});

// The shoppable pill carried on a feed video (video.schema.ts ProductTag).
export const toProductTag = (
  product: ProductModel,
  thumbnailUrl: string
): ProductTagJSON => ({
  productId: product.product_id,
  title: product.title,
  price: centsToMajor(product.price_cents),
  currency: product.currency,
  thumbnailUrl,
});
