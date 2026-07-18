import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendOk } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import { createReport } from '@services/reportService';
import type { ReportBody } from '@validators/reportValidators';

// POST /v1/reports { targetType, targetId, reason } → { ok: true } (201)
export const create = asyncHandler(async (req: Request, res: Response) => {
  await createReport(requireUserId(req), req.body as ReportBody);
  sendOk(res, 201);
});
