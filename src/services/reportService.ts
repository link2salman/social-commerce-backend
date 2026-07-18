import Report from '@models/moderation/Report';
import type { ReportTargetType } from '@constants/enums';

// Record a user report. INSERT-ONLY: the row lands in `reports` and nothing in
// this codebase ever reads it — there is no moderation queue, no review
// endpoint, no notification, and no automated action on the reported content.
// The client gets { ok: true } regardless, which is all its UI needs. Acting on
// a report today means querying the table by hand; a real moderation surface
// (or a worker draining this table) is the missing consumer.
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
