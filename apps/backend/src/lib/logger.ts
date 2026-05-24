import pino from 'pino';
import { env } from '../env.js';

const isDev = env.NODE_ENV !== 'production';

export const rootLogger = pino({
  level: isDev ? 'debug' : 'info',
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});

export function createLogger(name: string) {
  return rootLogger.child({ name });
}
