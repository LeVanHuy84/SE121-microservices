import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { context as otelContext, trace } from '@opentelemetry/api';

type NumericLevel = 0 | 1 | 2 | 3 | 4;

const LEVEL_PRIORITY = {
  error: 0,
  fatal: 0,
  warn: 1,
  log: 2,
  info: 2,
  debug: 3,
  verbose: 4,
} as const satisfies Record<string, NumericLevel>;

const LEVEL_MAP: Record<string, NumericLevel> = LEVEL_PRIORITY;

/**
 * Structured 1-line JSON logger for NestJS microservices.
 * Automatically enriches every log entry with active OpenTelemetry
 * `traceId` and `spanId` for Loki <-> Jaeger correlation.
 */
@Injectable()
export class StructuredLoggerService implements LoggerService {
  private readonly minPriority: NumericLevel;

  constructor(private readonly serviceName: string) {
    this.minPriority = this.resolveMinPriority();
  }

  private resolveMinPriority(): NumericLevel {
    if (
      process.env.ENABLE_LOAD_TEST_MODE === 'true' ||
      process.env.IS_SILENT === 'true'
    ) {
      return LEVEL_PRIORITY.warn;
    }

    const defaultLevel =
      process.env.NODE_ENV === 'production' ? 'warn' : 'info';
    const configured = (process.env.LOG_LEVEL || defaultLevel)
      .trim()
      .toLowerCase();
    return LEVEL_MAP[configured] ?? LEVEL_PRIORITY.info;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, optionalParams);
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // Controlled via LOG_LEVEL env var
  }

  private emit(
    level: string,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const priority = LEVEL_MAP[level] ?? LEVEL_PRIORITY.info;
    if (priority > this.minPriority) {
      return;
    }

    let contextName: string | undefined;
    let stack: string | undefined;

    if (optionalParams.length === 1 && typeof optionalParams[0] === 'string') {
      contextName = optionalParams[0];
    } else if (optionalParams.length >= 2) {
      if (typeof optionalParams[0] === 'string') {
        stack = optionalParams[0];
      }
      if (typeof optionalParams[1] === 'string') {
        contextName = optionalParams[1];
      }
    }

    const activeSpan = trace.getSpan(otelContext.active());
    const spanCtx = activeSpan?.spanContext();
    const hasValidTrace =
      spanCtx &&
      spanCtx.traceId &&
      spanCtx.traceId !== '00000000000000000000000000000000';

    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      ...(contextName ? { context: contextName } : {}),
      message: this.formatMessage(message),
      ...(hasValidTrace
        ? { traceId: spanCtx.traceId, spanId: spanCtx.spanId }
        : {}),
      ...(stack ? { stack } : {}),
    };

    const line = JSON.stringify(entry) + '\n';
    if (level === 'error' || level === 'fatal' || level === 'warn') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  private formatMessage(message: unknown): unknown {
    if (message instanceof Error) {
      return message.message;
    }
    return message;
  }
}
