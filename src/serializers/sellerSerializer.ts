import type { SellerModel } from '@models/commerce/Seller';

// A seller/shop profile. `is_owner` lets a management UI show edit controls only
// on the viewer's own shop.
export interface SellerJSON {
  id: string;
  name: string;
  rating: number;
  is_owner: boolean;
}

export const serializeSeller = (
  seller: SellerModel,
  viewerId: string
): SellerJSON => ({
  id: seller.seller_id,
  name: seller.name,
  rating: seller.rating,
  is_owner: seller.user_id === viewerId,
});
