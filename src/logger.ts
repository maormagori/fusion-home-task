import pino from 'pino';
import type { Config } from './config.js';

export type Logger = pino.Logger;

export function createLogger(level: Config['LOG_LEVEL']): Logger {
  return pino({ level });
}
