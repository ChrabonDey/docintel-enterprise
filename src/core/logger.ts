export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

class Logger {
  private format(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  }

  debug(message: string, meta?: unknown) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.format(LogLevel.DEBUG, message, meta));
    }
  }

  info(message: string, meta?: unknown) {
    console.info(this.format(LogLevel.INFO, message, meta));
  }

  warn(message: string, meta?: unknown) {
    console.warn(this.format(LogLevel.WARN, message, meta));
  }

  error(message: string, meta?: unknown) {
    console.error(this.format(LogLevel.ERROR, message, meta));
  }
}

export const logger = new Logger();

