import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('stays CLOSED on successful executions', async () => {
    const breaker = new CircuitBreaker({
      name: 'test-cb',
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });

    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('opens after reaching failureThreshold and short-circuits with fallback', async () => {
    const breaker = new CircuitBreaker({
      name: 'test-open',
      failureThreshold: 2,
      resetTimeoutMs: 5000,
    });

    const failing = async () => {
      throw new Error('downstream down');
    };

    await expect(breaker.execute(failing)).rejects.toThrow('downstream down');
    expect(breaker.getState()).toBe('CLOSED');

    await expect(breaker.execute(failing)).rejects.toThrow('downstream down');
    expect(breaker.getState()).toBe('OPEN');

    // While OPEN, fn should not be called and CircuitOpenError is thrown / passed to fallback
    const spy = jest.fn(async () => 'never');
    await expect(breaker.execute(spy)).rejects.toThrow(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();

    const fallbackRes = await breaker.execute(spy, () => 'degraded');
    expect(fallbackRes).toBe('degraded');
    expect(spy).not.toHaveBeenCalled();
  });

  it('transitions OPEN -> HALF_OPEN -> CLOSED after resetTimeoutMs', async () => {
    jest.useFakeTimers();
    try {
      const breaker = new CircuitBreaker({
        name: 'test-recover',
        failureThreshold: 1,
        resetTimeoutMs: 1000,
      });

      await expect(
        breaker.execute(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(breaker.getState()).toBe('OPEN');

      jest.advanceTimersByTime(1000);
      expect(breaker.getState()).toBe('HALF_OPEN');

      const res = await breaker.execute(async () => 'recovered');
      expect(res).toBe('recovered');
      expect(breaker.getState()).toBe('CLOSED');
    } finally {
      jest.useRealTimers();
    }
  });
});
