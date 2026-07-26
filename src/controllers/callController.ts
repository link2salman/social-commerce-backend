import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { sendList, sendSuccess } from '@utils/responseHandler';
import { requireUserId } from '@middlewares/auth';
import * as calls from '@services/callService';
import type { CallRecordBody } from '@validators/callValidators';

// GET /v1/calls → { items } (newest first)
export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await calls.listCalls(requireUserId(req));
  sendList(res, 'Call history fetched', result.items);
});

// GET /v1/calls/ice-servers → { data: { ice_servers } } for RTCPeerConnection
export const iceServers = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, 'ICE servers fetched', calls.getIceServers());
});

// POST /v1/calls { peer, direction, is_video, outcome, started_at, duration_sec }
//   → { data: CallRecord } (201)
export const record = asyncHandler(async (req: Request, res: Response) => {
  const call = await calls.recordCall(
    requireUserId(req),
    req.body as CallRecordBody
  );
  sendSuccess(res, 'Call recorded', call, 201);
});
