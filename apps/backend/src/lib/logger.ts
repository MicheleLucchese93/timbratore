import pino from 'pino';
import { env } from '../env.js';

const isDev = env.NODE_ENV !== 'production';

// `pino-pretty` is a transport, which means it runs in a worker thread
// (thread-stream). That is what you want on an interactive terminal and a
// liability anywhere else: on a pipe the colouring buys nothing, and the
// worker's teardown races with process exit — the last line is written and the
// process then never exits.
//
// That race is what burned the whole 20-minute budget of the `tests (postgres)`
// CI job in three separate runs: twice in `npm run migrate` (hanging right
// after the final "applied" line) and once between two test files (right after
// the last `auto_clockout` line). NODE_ENV is unset in CI, so `isDev` was true
// there and every script ran with a worker attached to a pipe.
//
// TTY-gating it also gives CI and any log collector structured JSON, which is
// what they can actually parse.
const pretty = isDev && process.stdout.isTTY === true;

export const rootLogger = pino({
  level: isDev ? 'debug' : 'info',
  transport: pretty
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});

export function createLogger(name: string) {
  return rootLogger.child({ name });
}
