import {
  CallHandler,
  ExecutionContext,
  GatewayTimeoutException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, TimeoutError, throwError } from "rxjs";
import { catchError, timeout } from "rxjs/operators";

const EXTENDED_TIMEOUT_PREFIXES = [
  "/chatbot",
  "/assistant",
  "/media",
  "/upload",
  "/music/analyze",
  "/ai",
];

/**
 * Enforces deterministic request timeouts at the API Gateway so slow or hung
 * downstream TCP/HTTP services fail fast with 504 Gateway Timeout.
 */
@Injectable()
export class RpcTimeoutInterceptor implements NestInterceptor {
  private readonly defaultTimeoutMs: number;
  private readonly aiTimeoutMs: number;

  constructor() {
    this.defaultTimeoutMs = parseInt(
      process.env.GATEWAY_RPC_TIMEOUT_MS || "8000",
      10,
    );
    this.aiTimeoutMs = parseInt(
      process.env.GATEWAY_AI_TIMEOUT_MS || "30000",
      10,
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<{ url?: string }>();
    const url = (req?.url || "").toLowerCase();

    // Skip SSE/streaming endpoints from fixed request timeout
    if (url.includes("stream")) {
      return next.handle();
    }

    const isExtended = EXTENDED_TIMEOUT_PREFIXES.some((prefix) =>
      url.includes(prefix),
    );
    const timeoutMs = url.includes("/music/analyze")
      ? Math.max(this.aiTimeoutMs, 65000)
      : isExtended
        ? this.aiTimeoutMs
        : this.defaultTimeoutMs;

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () =>
              new GatewayTimeoutException(
                `Upstream service timed out after ${timeoutMs}ms`,
              ),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
