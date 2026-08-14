export interface NotificationDeliveryErrorOptions {
  code?: string;
  retryable?: boolean;
  invalidTokens?: string[];
  cause?: unknown;
}

export class NotificationDeliveryError extends Error {
  readonly code?: string;
  readonly retryable: boolean;
  readonly invalidTokens: string[];
  override readonly cause?: unknown;

  constructor(
    message: string,
    {
      code,
      retryable = false,
      invalidTokens = [],
      cause,
    }: NotificationDeliveryErrorOptions = {},
  ) {
    super(message);
    this.name = "NotificationDeliveryError";
    this.code = code;
    this.retryable = retryable;
    this.invalidTokens = invalidTokens;
    this.cause = cause;
  }
}

export function isRetryableDeliveryError(error: unknown): boolean {
  return error instanceof NotificationDeliveryError && error.retryable === true;
}
