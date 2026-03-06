/**
 * Backend Logger Utility
 * Centralized logging with structured output and log levels.
 * Replaces direct console.* calls for consistency.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  return args.length > 0 ? `${prefix} ${message}` : `${prefix} ${message}`;
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (shouldLog('debug')) console.log(formatMessage('debug', message), ...args);
  },
  info(message: string, ...args: unknown[]) {
    if (shouldLog('info')) console.log(formatMessage('info', message), ...args);
  },
  warn(message: string, ...args: unknown[]) {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message), ...args);
  },
  error(message: string, ...args: unknown[]) {
    if (shouldLog('error')) console.error(formatMessage('error', message), ...args);
  },
};
