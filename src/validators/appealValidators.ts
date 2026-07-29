import { z } from 'zod';
import { APPEAL_TARGET_TYPES, APPEAL_DECISIONS } from '@constants/enums';

// POST /appeals — an authenticated user contests a moderation action against
// their own content/account. Ownership is enforced in the service.
export const appealSchema = z.object({
  target_type: z.enum(APPEAL_TARGET_TYPES),
  target_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
});
export type AppealBody = z.infer<typeof appealSchema>;

// POST /appeals/suspension — a locked-out (suspended) user appeals with their
// credentials instead of a token, since they can't sign in.
export const suspensionAppealSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  reason: z.string().trim().min(1).max(1000),
});
export type SuspensionAppealBody = z.infer<typeof suspensionAppealSchema>;

// POST /admin/appeals/resolve — a moderator grants (reverses) or denies.
export const resolveAppealSchema = z.object({
  appeal_id: z.string().uuid(),
  decision: z.enum(APPEAL_DECISIONS),
  note: z.string().max(500).optional(),
});
export type ResolveAppealBody = z.infer<typeof resolveAppealSchema>;
