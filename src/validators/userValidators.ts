import { z } from 'zod';

// PATCH /users/me — edit profile. Every field is optional (partial update); at
// least one must be present. avatar_url accepts a storage public URL or null (to
// clear the avatar back to the default).
export const updateProfileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(50).optional(),
    bio: z.string().max(300).optional(),
    avatar_url: z.string().url().nullable().optional(),
  })
  .refine(v => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
