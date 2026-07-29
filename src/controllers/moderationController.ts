import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendCursor, sendSuccess } from '@utils/responseHandler';
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

// GET /v1/admin/reports?status=&target_type=&cursor=&limit= → { items, next_cursor }
export const list = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  const page = await moderation.listReports(
    {
      status: asStatus(req.query.status),
      targetType: asTargetType(req.query.target_type),
    },
    cursor,
    limit
  );
  sendCursor(res, 'Reports fetched', page.items, page.nextCursor);
});

// GET /v1/admin/reports/:id → { data: report + hydrated target }
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const report = await moderation.getReport(req.params.id as string);
  sendSuccess(res, 'Report fetched', report);
});

// POST /v1/admin/reports/resolve { target_type, target_id, action, note? }
//   → { data: { resolved_count, action } }
export const resolve = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ResolveReportBody;
  const result = await moderation.resolveTarget({
    adminId: requireUserId(req),
    target_type: body.target_type,
    target_id: body.target_id,
    action: body.action,
    note: body.note,
  });
  sendSuccess(res, 'Report resolved', result);
});
