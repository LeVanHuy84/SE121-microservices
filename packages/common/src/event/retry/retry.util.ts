export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  backoffFactor?: number;
  timeoutMs?: number;
}

export async function retryWithBackoff(
  fn: () => Promise<void>,
  options: RetryOptions = {},
): Promise<void> {
  const {
    retries = 3,
    delayMs = 500,
    backoffFactor = 2,
    timeoutMs = 5000,
  } = options as RetryOptions & { timeoutMs?: number };

  let lastError: any;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await withTimeout(fn, timeoutMs);
      return;
    } catch (err) {
      lastError = err;

      if (attempt === retries - 1) break;

      const delay = delayMs * Math.pow(backoffFactor, attempt);
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  throw lastError;
}

async function withTimeout(fn: () => Promise<void>, timeoutMs: number) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout exceeded')), timeoutMs),
    ),
  ]);
}
