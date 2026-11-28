import { Logger } from '@nestjs/common';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number;
  resetTimeoutMs?: number;
}

export class CircuitOpenError extends Error {
  constructor(breakerName: string) {
    super(`Circuit breaker "${breakerName}" is OPEN`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Lightweight Circuit Breaker for downstream RPC/HTTP/AI calls.
 * Transitions: CLOSED -> OPEN (after consecutive failures) -> HALF_OPEN (after cooldown) -> CLOSED.
 */
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private nextAttemptAt = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() >= this.nextAttemptAt) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.nextAttemptAt = 0;
  }

  async execute<T>(
    fn: () => Promise<T>,
    fallback?: (error: unknown) => T | Promise<T>,
  ): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      const err = new CircuitOpenError(this.name);
      if (fallback) {
        return fallback(err);
      }
      throw err;
    }

    if (currentState === 'HALF_OPEN') {
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      if (fallback) {
        return fallback(err);
      }
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state !== 'CLOSED') {
      this.logger.log(`Circuit "${this.name}" recovered -> CLOSED`);
    }
    this.reset();
  }

  private onFailure(): void {
    this.failureCount += 1;
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
      this.logger.warn(
        `Circuit "${this.name}" opened for ${this.resetTimeoutMs}ms after ${this.failureCount} failures`,
      );
    }
  }
}
