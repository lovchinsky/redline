import type { LogContext, Logger } from '@redline/core';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LEVELS)[number];

export class ConsoleLogger implements Logger {
  constructor(
    private readonly scope: string,
    private readonly minLevel: LogLevel = 'info',
  ) {}

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  child(scope: string): Logger {
    return new ConsoleLogger(`${this.scope}:${scope}`, this.minLevel);
  }

  private write(level: LogLevel, message: string, context: LogContext | undefined): void {
    if (LEVELS.indexOf(level) < LEVELS.indexOf(this.minLevel)) return;
    const line = `[redline:${this.scope}] ${message}`;
    if (context === undefined) console[level](line);
    else console[level](line, context);
  }
}
