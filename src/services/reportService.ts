import Report from '@models/moderation/Report';
import type { ReportTargetType } from '@constants/enums';

// Record a user report from the mobile client. The client gets { ok: true }
// regardless (all its UI needs). The report is then drained by the moderation
// surface — `moderationService` lists it under /admin/reports and a moderator
// resolves it (dismiss / remove content / suspend user). This function stays
// write-only ON PURPOSE: the app submits, the admin console consumes.
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
