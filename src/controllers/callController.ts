import type { Request, Response } from 'express';
import { asyncHandler } from '@utils/asyncHandler';
import { send } from '@utils/respond';
import { requireUserId } from '@middlewares/auth';
import * as calls from '@services/callService';
import type { CallRecordBody } from '@validators/callValidators';

// GET /v1/calls → { items: CallRecord[] } (newest first)
export const list = asyncHandler(async (req: Request, res: Response) => {
  send(res, await calls.listCalls(requireUserId(req)));
});

// GET /v1/calls/ice-servers → { iceServers } for the app's RTCPeerConnection
export const iceServers = asyncHandler(async (_req: Request, res: Response) => {
  send(res, calls.getIceServers());
});

// POST /v1/calls { peer, direction, isVideo, outcome, startedAt, durationSec }
//   → CallRecord (201)
export const record = asyncHandler(async (req: Request, res: Response) => {
  send(res, await calls.recordCall(requireUserId(req), req.body as CallRecordBody), 201);
});
