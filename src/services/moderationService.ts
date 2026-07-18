import { Op } from 'sequelize';
import { sequelize } from '@config/db';
import Report from '@models/moderation/Report';
import User from '@models/user/User';
import Video from '@models/feed/Video';
import Comment from '@models/feed/Comment';
import { BadRequestError, NotFoundError } from '@middlewares/error';
import type {
  ReportStatus,
  ReportTargetType,
  ModerationAction,
} from '@constants/enums';
import {
  serializeReport,
  serializeVideoTarget,
  serializeUserTarget,
  serializeCommentTarget,
  type ReportJSON,
  type ReportDetailJSON,
  type ResolvedTarget,
} from '@serializers/moderationSerializer';
import { decodeCursor, encodeCursor, keysetWhere, clampPageSize } from '@utils/cursor';

const PAGE = 20;

export interface ListReportsFilter {
  status?: ReportStatus;
  targetType?: ReportTargetType;
}

/**
 * The moderation queue. Filterable by status (default: everything) and target
 * type, newest first, cursor-paginated. Each row carries its reporter so the
 * console can show who flagged it.
 */
export const listReports = async (
  filter: ListReportsFilter,
  rawCursor?: string,
  rawLimit?: string
): Promise<{ items: ReportJSON[]; nextCursor: string | null }> => {
  const cursor = decodeCursor(rawCursor);
  const limit = clampPageSize(rawLimit, PAGE);

  const rows = await Report.findAll({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.targetType ? { target_type: filter.targetType } : {}),
      ...keysetWhere(cursor, 'report_id'),
    },
    order: [
      ['created_at', 'DESC'],
      ['report_id', 'DESC'],
    ],
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const reporterIds = [...new Set(page.map(r => r.reporter_id))];
  const reporters = reporterIds.length
    ? await User.findAll({ where: { user_id: { [Op.in]: reporterIds } } })
    : [];
  const byId = new Map(reporters.map(u => [u.user_id, u]));

  const items = page.map(r => serializeReport(r, byId.get(r.reporter_id)));
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.created_at.toISOString(), id: last.report_id })
      : null;

  return { items, nextCursor };
};

// Resolve the polymorphic target for a moderator's detail view. Uses
// paranoid:false so an already-soft-deleted video still shows (removed:true) —
// the point of the view is to see what was acted on. A truly-gone target
// (hard-deleted comment, purged account) resolves to null rather than throwing.
const hydrateTarget = async (
  targetType: ReportTargetType,
  targetId: string
): Promise<ResolvedTarget> => {
  if (targetType === 'video') {
    const v = await Video.findByPk(targetId, { paranoid: false });
    return v ? serializeVideoTarget(v) : null;
  }
  if (targetType === 'user') {
    const u = await User.findByPk(targetId, { paranoid: false });
    return u ? serializeUserTarget(u) : null;
  }
  const c = await Comment.findByPk(targetId);
  return c ? serializeCommentTarget(c) : null;
};

export const getReport = async (reportId: string): Promise<ReportDetailJSON> => {
  const report = await Report.findByPk(reportId);
  if (!report) throw new NotFoundError('Report');
  const reporter = await User.findByPk(report.reporter_id);
  const target = await hydrateTarget(report.target_type, report.target_id);
  return { ...serializeReport(report, reporter), target };
};

// Which actions are legal for which target. dismiss is always allowed; the
// others must match the kind of thing being resolved.
const actionMatchesTarget = (action: ModerationAction, targetType: ReportTargetType): boolean => {
  if (action === 'dismiss') return true;
  if (action === 'remove_content') return targetType === 'video' || targetType === 'comment';
  return targetType === 'user'; // suspend_user
};

export interface ResolveInput {
  adminId: string;
  targetType: ReportTargetType;
  targetId: string;
  action: ModerationAction;
  note?: string;
}

/**
 * Resolve EVERY pending report against one target in a single transaction, and
 * perform the action once. Resolving per-report doesn't scale — a viral bad
 * video gets reported dozens of times — so the unit of moderation is the
 * target, not the individual report. Reports already resolved are left as-is
 * (the pending filter), so this is safe to re-run.
 *
 * Returns how many pending reports were closed. Zero is a real answer (nothing
 * pending for that target) and NOT an error — a moderator may act on a target
 * proactively.
 */
export const resolveTarget = async (
  input: ResolveInput
): Promise<{ resolvedCount: number; action: ModerationAction }> => {
  if (!actionMatchesTarget(input.action, input.targetType)) {
    throw new BadRequestError(
      `Action '${input.action}' is not valid for a ${input.targetType} target`
    );
  }

  return sequelize.transaction(async transaction => {
    // Perform the content action first — if it fails (e.g. the target is gone),
    // the whole transaction rolls back and no report is marked resolved.
    if (input.action === 'remove_content') {
      if (input.targetType === 'video') {
        const v = await Video.findByPk(input.targetId, { transaction });
        if (v) await v.destroy({ transaction }); // paranoid → soft delete
      } else if (input.targetType === 'comment') {
        const c = await Comment.findByPk(input.targetId, { transaction });
        if (c) await c.destroy({ transaction }); // not paranoid → hard delete
      }
    } else if (input.action === 'suspend_user') {
      const u = await User.findByPk(input.targetId, { transaction });
      if (u) await u.update({ is_active: false }, { transaction });
    }

    const newStatus: ReportStatus = input.action === 'dismiss' ? 'dismissed' : 'actioned';
    const [resolvedCount] = await Report.update(
      {
        status: newStatus,
        reviewed_by: input.adminId,
        reviewed_at: new Date(),
        resolution_note: input.note ?? null,
      },
      {
        where: {
          target_type: input.targetType,
          target_id: input.targetId,
          status: 'pending',
        },
        transaction,
      }
    );

    return { resolvedCount, action: input.action };
  });
};
