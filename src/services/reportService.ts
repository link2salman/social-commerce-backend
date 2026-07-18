import Report from '@models/moderation/Report';
import type { ReportTargetType } from '@constants/enums';

// Record a user report. Fire-and-forget from the client's view ({ ok: true });
// a moderation queue consumes these later.
export const createReport = async (
  reporterId: string,
  input: { targetType: ReportTargetType; targetId: string; reason: string }
): Promise<void> => {
  await Report.create({
    reporter_id: reporterId,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
  });
};
