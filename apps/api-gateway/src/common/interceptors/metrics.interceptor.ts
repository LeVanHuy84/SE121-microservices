import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Counter, Histogram } from "prom-client";

// Define metrics
const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest();
    const res = httpContext.getResponse();

    // Only track HTTP requests
    if (!req || !req.method) {
      return next.handle();
    }

    const startTime = process.hrtime();

    return next.handle().pipe(
      tap({
        next: () => this.recordMetrics(req, res, startTime),
        error: (err) => {
          // Track errors too, fallback status to 500 if not specified
          const status = err?.status || err?.statusCode || 500;
          this.recordMetrics(req, { statusCode: status }, startTime);
        },
      }),
    );
  }

  private recordMetrics(req: any, res: any, startTime: [number, number]) {
    const diff = process.hrtime(startTime);
    const duration = diff[0] + diff[1] / 1e9;
    const status = res.statusCode || 200;
    const method = req.method;

    // Resolve route pattern if available (e.g. /api/v1/users/:id)
    const route = req.route?.path || req.url || "unknown";

    try {
      httpRequestsTotal.labels(method, route, String(status)).inc();
      httpRequestDurationSeconds
        .labels(method, route, String(status))
        .observe(duration);
    } catch (err) {
      // Prevent failure in metrics recording from breaking the actual request
    }
  }
}
