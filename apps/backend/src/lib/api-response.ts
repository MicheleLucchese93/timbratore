import type { Response } from 'express';

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ ok: true, data });
}

export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): Response {
  const body: Record<string, unknown> = { ok: false, error: { code, message } };
  if (details !== undefined) (body.error as Record<string, unknown>).details = details;
  return res.status(status).json(body);
}
