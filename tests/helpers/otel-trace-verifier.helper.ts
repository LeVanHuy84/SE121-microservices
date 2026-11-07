/**
 * otel-trace-verifier.helper.ts
 * Verifies OpenTelemetry W3C distributed trace context propagation (traceparent).
 */

export interface W3CTraceContext {
  version: string;
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
}

export class OtelTraceVerifierHelper {
  /**
   * Generates a valid W3C traceparent header string.
   */
  static generateTraceparent(traceId?: string, spanId?: string): string {
    const tid = traceId || Math.random().toString(16).substring(2, 10).padStart(32, '0');
    const sid = spanId || Math.random().toString(16).substring(2, 10).padStart(16, '0');
    return `00-${tid}-${sid}-01`;
  }

  /**
   * Parses and validates a W3C traceparent header.
   */
  static parseTraceparent(headerValue: string): W3CTraceContext | null {
    if (!headerValue || typeof headerValue !== 'string') return null;
    const parts = headerValue.split('-');
    if (parts.length !== 4) return null;
    const [version, traceId, parentSpanId, traceFlags] = parts;
    if (version.length !== 2 || traceId.length !== 32 || parentSpanId.length !== 16) {
      return null;
    }
    return { version, traceId, parentSpanId, traceFlags };
  }

  /**
   * Asserts trace context integrity across downstream hops.
   */
  static assertTraceContinuity(
    upstreamHeader: string,
    downstreamHeader: string,
  ): { isMatch: boolean; traceId: string } {
    const upstream = this.parseTraceparent(upstreamHeader);
    const downstream = this.parseTraceparent(downstreamHeader);

    if (!upstream || !downstream) {
      return { isMatch: false, traceId: '' };
    }

    const isMatch = upstream.traceId === downstream.traceId;
    return { isMatch, traceId: upstream.traceId };
  }
}
