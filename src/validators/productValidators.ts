import { z } from 'zod';

// Seller supply-side write shapes. Money is MAJOR-unit dollars on the wire (the
// same units the product READ contract uses); the service converts to integer
// cents at the boundary. These are new endpoints, so the app's read schema is
// unaffected — a create/update response is the exact ProductJSON it already parses.

export const becomeSellerSchema = z.object({
  name: z.string().trim().min(1, 'A shop name is required').max(120),
});

const variantInput = z.object({
  name: z.string().trim().min(1).max(120),
  // Dollars; may be negative (a cheaper variant).
  priceDelta: z.number().finite(),
});

export const createProductSchema = z.object({
  title: z.string().trim().min(1, 'A title is required').max(200),
  description: z.string().trim().max(4000).optional().default(''),
  price: z.number().nonnegative('Price cannot be negative'), // dollars
  currency: z.string().trim().length(3).optional().default('USD'),
  stock: z.number().int().nonnegative(),
  images: z.array(z.string().url()).max(10).optional().default([]),
  variants: z.array(variantInput).max(20).optional().default([]),
});

// Every field optional (a partial update); images/variants, when present,
// REPLACE the existing sets. At least one field must be supplied.
export const updateProductSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    price: z.number().nonnegative().optional(),
    currency: z.string().trim().length(3).optional(),
    stock: z.number().int().nonnegative().optional(),
    images: z.array(z.string().url()).max(10).optional(),
    variants: z.array(variantInput).max(20).optional(),
  })
  .refine(obj => Object.keys(obj).length > 0, {
    message: 'Provide at least one field to update',
  });

export type BecomeSellerBody = z.infer<typeof becomeSellerSchema>;
export type CreateProductBody = z.infer<typeof createProductSchema>;
export type UpdateProductBody = z.infer<typeof updateProductSchema>;
