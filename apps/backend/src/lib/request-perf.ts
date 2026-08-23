import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { Pool, PoolClient } from 'pg';
import { env } from '../env.js';
import { createLogger } from './logger.js';

const logger = createLogger('db-perf');

/**
 * Per-request database accounting.
 *
 * Why it exists: `requestLogger` could already tell you a request took 1300ms
 * but not whether that was SQL, JS or queue wait, so every "the app feels slow"
 * report ended in a manual pg_stat_statements dig. `dbMs`/`dbCalls` split the
 * request duration at the only boundary that matters here, and the same numbers
 * go out on the `Server-Timing` header so the split is visible in the browser's
 * network panel without touching the server at all.
 */
export interface RequestPerf {
  reqId: string;
  dbMs: number;
  dbCalls: number;
}

const store = new AsyncLocalStorage<RequestPerf>();

export function runWithPerf<T>(ctx: RequestPerf, fn: () => T): T {
  return store.run(ctx, fn);
}

/**
 * SQL TEXT ONLY — never the parameter values.
 *
 * Parameters carry personal data (emails, notes, GPS-derived distances, tenant
 * and user ids), and this line goes to the container log where retention is
 * measured in weeks. The statement text is enough to identify the query.
 */
function sqlLabel(arg: unknown): string {
  const text =
    typeof arg === 'string'
      ? arg
      : arg && typeof arg === 'object' && typeof (arg as { text?: unknown }).text === 'string'
        ? (arg as { text: string }).text
        : '<unknown>';
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function record(durMs: number, firstArg: unknown): void {
  const ctx = store.getStore();
  if (ctx) {
    ctx.dbMs += durMs;
    ctx.dbCalls += 1;
  }
  if (durMs >= env.SLOW_QUERY_MS) {
    logger.warn(
      { reqId: ctx?.reqId, durMs: Math.round(durMs), sql: sqlLabel(firstArg) },
      'slow query'
    );
  }
}

type QueryFn = (...args: unknown[]) => unknown;

/**
 * Wrap a pg `query` so its duration lands in the ambient RequestPerf.
 *
 * pg returns a promise only when called without a callback and without a
 * Submittable (a Cursor); the codebase always awaits, but the non-promise path
 * still has to pass the return value through untouched rather than assume.
 */
function timed(original: QueryFn, self: unknown): QueryFn {
  return function (this: unknown, ...args: unknown[]): unknown {
    const start = performance.now();
    const finish = (): void => record(performance.now() - start, args[0]);
    const out = original.apply(self, args);
    if (out && typeof (out as Promise<unknown>).then === 'function') {
      return (out as Promise<unknown>).then(
        (v) => {
          finish();
          return v;
        },
        (err) => {
          finish();
          throw err;
        }
      );
    }
    finish();
    return out;
  };
}

/**
 * Instrument a pooled client for the life of ONE checkout, returning the undo.
 *
 * The undo is not optional: pg hands out the same PoolClient object again on
 * the next connect(), so a patch left in place would outlive the request that
 * installed it and stack a new wrapper on every checkout.
 */
export function instrumentClient(client: PoolClient): () => void {
  const original = client.query as unknown as QueryFn;
  const patched = client as unknown as { query: QueryFn };
  patched.query = timed(original, client);
  return () => {
    patched.query = original;
  };
}

/** Instrument a pool's own one-shot `query()`. Pools are singletons — patch once. */
export function instrumentPool(pool: Pool): void {
  const target = pool as unknown as { query: QueryFn };
  const original = target.query;
  target.query = timed(original, pool);
}
