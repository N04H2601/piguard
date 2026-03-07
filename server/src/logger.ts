import pino from 'pino';
import { getConfig } from './config.js';

let logger: pino.Logger;

export function initLogger(): pino.Logger {
  const config = getConfig();
  logger = pino({
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) throw new Error('Logger not initialized');
  return logger;
}
