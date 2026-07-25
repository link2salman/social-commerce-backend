import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send, sendOk } from '@utils/respond';
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
// POST /v1/appeals { targetType, targetId, reason } → { ok: true } (201)
export const create = asyncHandler(async (req: Request, res: Response) => {
  await appeals.createAppeal(requireUserId(req), req.body as AppealBody);
  sendOk(res, 201);
});

// POST /v1/appeals/suspension { email, password, reason } → { ok: true } (201)
// Unauthenticated — a suspended user is locked out of a session.
export const createSuspension = asyncHandler(async (req: Request, res: Response) => {
  await appeals.createSuspensionAppeal(req.body as SuspensionAppealBody);
  sendOk(res, 201);
});

// ── Admin surface ────────────────────────────────────────────────────────────
// GET /v1/admin/appeals?status=&targetType=&cursor=&limit= → { items, nextCursor }
export const list = asyncHandler(async (req: Request, res: Response) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  send(
    res,
    await appeals.listAppeals(
      { status: asStatus(req.query.status), targetType: asTargetType(req.query.targetType) },
      cursor,
      limit
    )
  );
});

// GET /v1/admin/appeals/:id → appeal + hydrated target
export const detail = asyncHandler(async (req: Request, res: Response) => {
  send(res, await appeals.getAppeal(req.params.id as string));
});

// POST /v1/admin/appeals/resolve { appealId, decision, note? } → { appealId, status, decision }
export const resolve = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ResolveAppealBody;
  send(
    res,
    await appeals.resolveAppeal({
      adminId: requireUserId(req),
      appealId: body.appealId,
      decision: body.decision,
      note: body.note,
    })
  );
});
