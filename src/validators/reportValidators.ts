import { z } from 'zod';
import { REPORT_TARGET_TYPES } from '@constants/enums';

// POST /reports — { targetType, targetId, reason }. Mirrors report.schema.ts.
// reason is stored free-text (bounded); the client only ever sends one of the
// seven canned reasons, but we don't hard-enum it so the copy can evolve.
export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(1).max(120),
});

export type ReportBody = z.infer<typeof reportSchema>;
