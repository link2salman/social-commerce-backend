import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import { createReport } from '@services/reportService';
import type { ReportBody } from '@validators/reportValidators';

// POST /v1/reports { target_type, target_id, reason } → 201
export const create = asyncHandler(async (req: Request, res: Response) => {
  await createReport(requireUserId(req), req.body as ReportBody);
  sendSuccess(res, 'Report submitted', undefined, 201);
});
