import type { Request, Response, NextFunction } from 'express';
import { performance } from 'node:perf_hooks';
import { env } from '../env.js';
import { createLogger } from '../lib/logger.js';
import { isAllowedOrigin } from '../lib/cors-origins.js';
import { runWithPerf, type RequestPerf } from '../lib/request-perf.js';

const logger = createLogger('http');

/**
 * Mount-qualified, parameterised route — the aggregation key.
 *
 * `req.path` alone is router-RELATIVE: inside a mounted router it is the path
 * left after the mount prefix is stripped, so /api/v1/shifts/anomalies logged as
 * "/anomalies" and every create in the app logged as "POST /". Grouping by it
 * was meaningless. `baseUrl + route.path` gives "/api/v1/users/:id/reset-password"
 * — stable across ids, unique across mounts.
 */
function routeOf(req: Request): string {
  const base = req.baseUrl || '';
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  const tail = typeof routePath === 'string' && routePath !== '/' ? routePath : '';
  return `${base}${tail}` || req.originalUrl.split('?')[0] || req.path;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  const perf: RequestPerf = { reqId: req.id, dbMs: 0, dbCalls: 0 };
  let bytes = 0;
  // Captured while the handler is still on the stack. `req.baseUrl`, `req.route`
  // and `req.url` are all mutated by the router during dispatch and restored as
  // it unwinds, and 'finish' fires after the response is flushed — by then they
  // may already be back to their outermost values.
  let route = '';

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const originalWriteHead = res.writeHead.bind(res);

  // Byte accounting sits ABOVE compression in the middleware order, but
  // compression replaces res.write/res.end after us and calls through to
  // whatever it found — these wrappers — so what lands here is the compressed
  // wire size. That is the number that explains a slow page.
  const countChunk = (chunk: unknown, enc: unknown): void => {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
    try {
      bytes += Buffer.byteLength(
        chunk as string | Buffer,
        typeof enc === 'string' ? (enc as BufferEncoding) : undefined
      );
    } catch {
      // A chunk type Buffer.byteLength won't measure must never break the response.
    }
  };

  res.write = function (this: Response, chunk: unknown, ...rest: unknown[]): boolean {
    countChunk(chunk, rest[0]);
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  } as typeof res.write;

  res.end = function (this: Response, chunk?: unknown, ...rest: unknown[]): Response {
    countChunk(chunk, rest[0]);
    return (originalEnd as (...a: unknown[]) => Response)(chunk, ...rest);
  } as typeof res.end;

  // Node calls writeHead (via _implicitHeader) right before the first byte goes
  // out, which is the last moment a header can still be added.
  res.writeHead = function (this: Response, ...args: unknown[]): Response {
    if (!res.headersSent) {
      route = routeOf(req);
      const total = performance.now() - start;
      const app = Math.max(0, total - perf.dbMs);
      res.setHeader(
        'Server-Timing',
        `db;dur=${perf.dbMs.toFixed(1)}, app;dur=${app.toFixed(1)}, total;dur=${total.toFixed(1)}`
      );
      const origin = req.headers.origin;
      if (isAllowedOrigin(origin)) res.setHeader('Timing-Allow-Origin', origin as string);
    }
    return (originalWriteHead as (...a: unknown[]) => Response)(...args);
  } as typeof res.writeHead;

  // 'finish' fires when the response is flushed — which, for every tenantHandler
  // route, happens INSIDE the transaction: handlers call ok() before the wrapper
  // commits (see lib/route-helpers.ts). So the trailing COMMIT lands after this
  // line and is deliberately absent from dbMs/dbCalls. Nothing to chase: it is
  // sub-millisecond, and a header already on the wire could not carry it anyway.
  res.on('finish', () => {
    const durMs = Math.round(performance.now() - start);
    const line = {
      reqId: req.id,
      method: req.method,
      route: route || routeOf(req),
      url: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durMs,
      dbMs: Math.round(perf.dbMs),
      dbCalls: perf.dbCalls,
      bytes,
      // Pseudonymous ids only — no email — so a slow request can be traced to
      // the company and account that hit it without putting names in the log.
      tenant: req.user?.tenantId,
      uid: req.user?.id,
    };
    if (durMs >= env.SLOW_REQUEST_MS) logger.warn(line, 'slow request');
    else logger.info(line);
  });

  runWithPerf(perf, () => next());
}
