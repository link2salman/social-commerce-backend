import { z } from 'zod';
import {
  REPORT_TARGET_TYPES,
  MODERATION_ACTIONS,
} from '@constants/enums';

// POST /admin/reports/resolve — resolve every pending report against a target.
// The service enforces that the action matches the target type (a 400); the
// schema only shapes the request.
export const resolveReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  action: z.enum(MODERATION_ACTIONS),
  note: z.string().max(500).optional(),
});

export type ResolveReportBody = z.infer<typeof resolveReportSchema>;
