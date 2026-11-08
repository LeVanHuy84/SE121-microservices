import { retryWithBackoff } from './retry.util';

describe('retryWithBackoff (Suite 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('TC-COM-01: should succeed on the first attempt without retrying', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await retryWithBackoff(fn, { retries: 3, delayMs: 10 });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use default options when none are provided', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await retryWithBackoff(fn);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('TC-COM-02: should retry on failure and succeed if subsequent attempt resolves', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('NetworkError attempt 1'))
      .mockRejectedValueOnce(new Error('NetworkError attempt 2'))
      .mockResolvedValueOnce(undefined);

    await retryWithBackoff(fn, {
      retries: 3,
      delayMs: 10,
      backoffFactor: 2,
    });

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('TC-COM-03: should throw lastError when all retries fail', async () => {
    const finalError = new Error('Persistent failure');
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockRejectedValueOnce(finalError);

    await expect(
      retryWithBackoff(fn, { retries: 3, delayMs: 10 }),
    ).rejects.toThrow('Persistent failure');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('TC-COM-04: should fail with timeout when execution hangs past timeoutMs and retry', async () => {
    let callCount = 0;
    const fn = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call hangs past timeoutMs (50ms)
        return new Promise((resolve) => setTimeout(resolve, 150));
      }
      return Promise.resolve();
    });

    await retryWithBackoff(fn, {
      retries: 2,
      delayMs: 10,
      timeoutMs: 50,
    });

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw Timeout exceeded if all attempts exceed timeoutMs', async () => {
    const fn = jest.fn().mockImplementation(() => {
      return new Promise((resolve) => setTimeout(resolve, 100));
    });

    await expect(
      retryWithBackoff(fn, {
        retries: 2,
        delayMs: 10,
        timeoutMs: 30,
      }),
    ).rejects.toThrow('Timeout exceeded');

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

