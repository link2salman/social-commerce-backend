import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendCursor, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import * as appeals from '@services/appealService';
import {
  APPEAL_STATUSES,
  APPEAL_TARGET_TYPES,
  type AppealStatus,
  type AppealTargetType,
} from '@constants/enums';
import type { AppealBody, SuspensionAppealBody, ResolveAppealBody } from '@validators/appealValidators';

const asStatus = (v: unknown): AppealStatus | undefined =>
  typeof v === 'string' && (APPEAL_STATUSES as readonly string[]).includes(v)
    ? (v as AppealStatus)
    : undefined;

const asTargetType = (v: unknown): AppealTargetType | undefined =>
  typeof v === 'string' && (APPEAL_TARGET_TYPES as readonly string[]).includes(v)
    ? (v as AppealTargetType)
    : undefined;

// ── User-facing ──────────────────────────────────────────────────────────────
// POST /v1/appeals { target_type, target_id, reason } → 201
export const create = asyncHandler(async (req: Request, res: Response) => {
  await appeals.createAppeal(requireUserId(req), req.body as AppealBody);
  sendSuccess(res, 'Appeal submitted', undefined, 201);
});

// POST /v1/appeals/suspension { email, password, reason } → 201
// Unauthenticated — a suspended user is locked out of a session.
export const createSuspension = asyncHandler(async (req: Request, res: Response) => {
  await appeals.createSuspensionAppeal(req.body as SuspensionAppealBody);
  sendSuccess(res, 'Appeal submitted', undefined, 201);
});

// ── Admin surface ────────────────────────────────────────────────────────────
// GET /v1/admin/appeals?status=&target_type=&cursor=&limit= → { items, next_cursor }
export const list = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  const page = await appeals.listAppeals(
    {
      status: asStatus(req.query.status),
      targetType: asTargetType(req.query.target_type),
    },
    cursor,
    limit
  );
  sendCursor(res, 'Appeals fetched', page.items, page.nextCursor);
});

// GET /v1/admin/appeals/:id → { data: appeal + hydrated target }
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const appeal = await appeals.getAppeal(req.params.id as string);
  sendSuccess(res, 'Appeal fetched', appeal);
});

// POST /v1/admin/appeals/resolve { appeal_id, decision, note? }
//   → { data: { appeal_id, status, decision } }
export const resolve = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ResolveAppealBody;
  const result = await appeals.resolveAppeal({
    adminId: requireUserId(req),
    appeal_id: body.appeal_id,
    decision: body.decision,
    note: body.note,
  });
  sendSuccess(res, 'Appeal resolved', result);
});
