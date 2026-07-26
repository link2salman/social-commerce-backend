import { z } from 'zod';
import { REPORT_TARGET_TYPES } from '@constants/enums';

// POST /reports — { target_type, target_id, reason }. Mirrors report.schema.ts.
// reason is stored free-text (bounded); the client only ever sends one of the
// seven canned reasons, but we don't hard-enum it so the copy can evolve.
export const reportSchema = z.object({
  target_type: z.enum(REPORT_TARGET_TYPES),
  target_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(120),
});

export type ReportBody = z.infer<typeof reportSchema>;
