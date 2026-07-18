import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import * as moderation from '@services/moderationService';
import {
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
  type ReportStatus,
  type ReportTargetType,
} from '@constants/enums';
import type { ResolveReportBody } from '@validators/moderationValidators';

const asStatus = (v: unknown): ReportStatus | undefined =>
  typeof v === 'string' && (REPORT_STATUSES as readonly string[]).includes(v)
    ? (v as ReportStatus)
    : undefined;

const asTargetType = (v: unknown): ReportTargetType | undefined =>
  typeof v === 'string' && (REPORT_TARGET_TYPES as readonly string[]).includes(v)
    ? (v as ReportTargetType)
    : undefined;

// GET /v1/admin/reports?status=&targetType=&cursor=&limit= → { items, nextCursor }
export const list = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  send(
    res,
    await moderation.listReports(
      { status: asStatus(req.query.status), targetType: asTargetType(req.query.targetType) },
      cursor,
      limit
    )
  );
});

// GET /v1/admin/reports/:id → report + hydrated target
export const detail = asyncHandler(async (req: Request, res: Response) => {
  send(res, await moderation.getReport(req.params.id as string));
});

// POST /v1/admin/reports/resolve { targetType, targetId, action, note? } → { resolvedCount, action }
export const resolve = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ResolveReportBody;
  send(
    res,
    await moderation.resolveTarget({
      adminId: requireUserId(req),
      targetType: body.targetType,
      targetId: body.targetId,
      action: body.action,
      note: body.note,
    })
  );
});
