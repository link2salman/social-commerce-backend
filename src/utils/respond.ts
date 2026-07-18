import type { Response } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// DELIBERATE DIVERGENCE from the reference backend's { success, message, data }
// envelope: the mobile client's Zod boundary runs `schema.parse(json)` on the
// RAW body, so every success response is the exact shape the client's schema
// expects, unwrapped. The client is the spec and is not editable here.
//
// Errors DO carry a small shape ({ message }) via the error middleware, but the
// client (ky, throwHttpErrors) never parses an error body — only the status
// code matters — so the body is for humans/logs.
// ─────────────────────────────────────────────────────────────────────────────

/** Send a raw payload exactly as the client schema expects it. */
export const send = <T>(res: Response, body: T, status = 200): Response =>
  res.status(status).json(body);

/** The `{ ok: true }` acknowledgement the client uses for toggle mutations. */
export const sendOk = (res: Response, status = 200): Response =>
  res.status(status).json({ ok: true });
