import { z } from 'zod';

// Mirrors the mobile client's auth.schema.ts exactly (the client validates the
// same rules on its side; we re-enforce server-side — never trust the client).
export const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Minimum 8 characters'),
});

export const signupSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Minimum 8 characters'),
  username: z
    .string()
    .min(3, 'At least 3 characters')
    .max(24)
    .regex(/^[a-z0-9_.]+$/, 'Lowercase letters, numbers, _ and . only'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export type LoginBody = z.infer<typeof loginSchema>;
export type SignupBody = z.infer<typeof signupSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;
