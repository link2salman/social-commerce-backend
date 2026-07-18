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

// POST /auth/forgot-password — request an emailed reset code.
export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

// POST /auth/reset-password — verify the code and set a new password.
export const resetPasswordSchema = z.object({
  email: z.string().email('Enter a valid email'),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  password: z.string().min(8, 'Minimum 8 characters'),
});

export type LoginBody = z.infer<typeof loginSchema>;
export type SignupBody = z.infer<typeof signupSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
