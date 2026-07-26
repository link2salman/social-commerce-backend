import { Op } from 'sequelize';
import Report from '@models/moderation/Report';
import { TooManyRequestsError } from '@middlewares/error';
import type { ReportTargetType } from '@constants/enums';

// Spam guard on user reports. Every report is moderator work, and a lone user
// filing dozens in a burst is almost always abuse (mass-flagging a target or a
// person). Two cheap guards, both derived from the existing `reports` table — no
// new column, no counter to maintain:
//
//   1. De-dupe — a second report from the same user against a target they've
//      already got PENDING in the queue is a no-op. Reporting twice shouldn't
//      feel like a failure, and the moderator already sees it (reports collapse
//      per-target on resolve), so this is silent success, not an error.
//   2. Rate limit — more than MAX_REPORTS_PER_WINDOW *distinct* reports from one
//      user inside REPORT_WINDOW_MS → 429. Deliberately generous: a real user
//      tidying their feed never trips it; a script mass-flagging does.
export const REPORT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const MAX_REPORTS_PER_WINDOW = 20;

// Record a user report from the mobile client. The client gets { ok: true } on
// success (all its UI needs). The report is then drained by the moderation
// surface — `moderationService` lists it under /admin/reports and a moderator
// resolves it (dismiss / remove content / suspend user). This function stays
// write-only ON PURPOSE: the app submits, the admin console consumes.
export const createReport = async (
  reporterId: string,
  input: { target_type: ReportTargetType; target_id: string; reason: string }
): Promise<void> => {
  // (1) De-dupe against an open report from this user on the same target.
  const existing = await Report.findOne({
    where: {
      reporter_id: reporterId,
      target_type: input.target_type,
      target_id: input.target_id,
      status: 'pending',
    },
  });
  if (existing) return;

  // (2) Rolling-window rate limit across all of this user's recent reports.
  const since = new Date(Date.now() - REPORT_WINDOW_MS);
  const recent = await Report.count({
    where: { reporter_id: reporterId, created_at: { [Op.gte]: since } },
  });
  if (recent >= MAX_REPORTS_PER_WINDOW) {
    throw new TooManyRequestsError(
      'You have filed too many reports recently. Please try again later.'
    );
  }

  await Report.create({
    reporter_id: reporterId,
    target_type: input.target_type,
    target_id: input.target_id,
    reason: input.reason,
  });
};
