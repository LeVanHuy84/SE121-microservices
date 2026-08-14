import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  GatewayTimeoutException,
  MessageEvent,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom, Observable } from "rxjs";
import { AxiosError } from "axios";

import {
  AssistantContextItemDto,
  AssistantMessageDto,
  AssistantRespondDataDto,
  AssistantRespondResponseDto,
  ChatbotClearHistoryResponseDto,
  ChatbotHistoryResponseDto,
} from "@repo/dtos";
import { AssistantContextService } from "./assistant-context.service";

type RespondCacheEntry = {
  value: AssistantRespondDataDto;
  expiresAt: number;
};

type LatencySummary = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
};

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly metricsLatencies = new Map<string, number[]>();
  private readonly metricsCounters = new Map<string, number>();

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly contextService: AssistantContextService,
  ) {}

  respondStream(
    userId: string,
    dto: AssistantMessageDto,
  ): Observable<MessageEvent> {
    const { baseUrl, internalKey } = this.resolveClientConfig();

    return new Observable<MessageEvent>((subscriber) => {
      let isCancelled = false;

      const run = async () => {
        try {
          const contexts = await this.resolveContextsWithinBudget(
            userId,
            dto.message,
            this.configService.get<number>(
              "CHATBOT_CONTEXT_BUILD_TIMEOUT_MS",
              1200,
            ),
          );

          if (isCancelled) return;

          const response = await firstValueFrom(
            this.httpService.post(
              `${baseUrl}/assistant/respond-stream`,
              {
                userId,
                message: dto.message,
                clientMessageId: dto.clientMessageId,
                contexts,
              },
              {
                headers: {
                  "x-internal-key": internalKey,
                  Accept: "text/event-stream",
                },
                responseType: "stream",
              },
            ),
          );

          const stream = response.data;
          let buffer = "";

          stream.on("data", (chunk: Buffer) => {
            if (isCancelled) return;

            buffer += chunk.toString();
            const lines = buffer.split("\n");

            // Keep the last partial line in buffer
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith("data: ")) {
                const dataStr = trimmedLine.replace("data: ", "").trim();
                if (dataStr) {
                  try {
                    const data = JSON.parse(dataStr);
                    subscriber.next({ data });
                  } catch (e) {
                    // This might happen if a JSON is split across lines (though SSE usually doesn't do that)
                    // Or if there's noise in the stream
                    this.logger.debug(
                      "Failed to parse SSE line, keeping in buffer",
                      trimmedLine,
                    );
                    // If parse fails, it might be a split JSON across lines,
                    // but SSE spec says data: should contain the full JSON per line for our backend.
                    // We'll ignore noise for now.
                  }
                }
              }
            }
          });

          stream.on("end", () => {
            if (isCancelled) return;
            subscriber.complete();
          });

          stream.on("error", (err) => {
            if (isCancelled) return;
            this.logger.error("Assistant stream error", err);
            subscriber.error(err);
          });
        } catch (error) {
          if (isCancelled) return;
          this.logger.error("Assistant stream setup failed", error);
          subscriber.error(error);
        }
      };

      run();

      return () => {
        isCancelled = true;
      };
    });
  }

  async getHistory(
    userId: string,
    pageSize?: number,
    beforeCreatedAt?: string,
    beforeId?: string,
  ) {
    const startedAt = Date.now();
    const { baseUrl, internalKey, timeoutMs } = this.resolveClientConfig();

    const params: Record<string, string | number> = {};
    if (pageSize) params.page_size = pageSize;
    if (beforeCreatedAt) params.before_created_at = beforeCreatedAt;
    if (beforeId) params.before_id = beforeId;

    try {
      const res = await firstValueFrom(
        this.httpService.get<ChatbotHistoryResponseDto>(
          `${baseUrl}/assistant/history/${encodeURIComponent(userId)}`,
          {
            headers: {
              "x-internal-key": internalKey,
            },
            params,
            timeout: timeoutMs,
          },
        ),
      );

      return res.data.data;
    } catch (error) {
      throw this.mapGatewayError(
        error,
        userId,
        startedAt,
        "assistant.history.get",
      );
    }
  }

  async clearHistory(userId: string) {
    const startedAt = Date.now();
    const { baseUrl, internalKey, timeoutMs } = this.resolveClientConfig();

    try {
      const res = await firstValueFrom(
        this.httpService.delete<ChatbotClearHistoryResponseDto>(
          `${baseUrl}/assistant/history/${encodeURIComponent(userId)}`,
          {
            headers: {
              "x-internal-key": internalKey,
            },
            timeout: timeoutMs,
          },
        ),
      );

      return res.data.data;
    } catch (error) {
      throw this.mapGatewayError(
        error,
        userId,
        startedAt,
        "assistant.history.clear",
      );
    }
  }

  private async resolveContextsWithinBudget(
    userId: string,
    message: string,
    timeoutMs: number,
  ): Promise<AssistantContextItemDto[]> {
    return await new Promise<AssistantContextItemDto[]>((resolve) => {
      let settled = false;
      const timer = setTimeout(
        () => {
          if (settled) return;
          settled = true;
          this.logger.warn(
            `assistant.context timeout userId=${userId} timeoutMs=${timeoutMs}`,
          );
          resolve([]);
        },
        Math.max(timeoutMs, 1),
      );

      this.contextService
        .buildContexts(userId, message)
        .then((contexts) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(contexts);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.logger.warn(
            `assistant.context fallback userId=${userId} reason=${error instanceof Error ? error.message : String(error)}`,
          );
          resolve([]);
        });
    });
  }

  private resolveClientConfig() {
    const baseUrl =
      this.configService.get<string>("AI_CHATBOT_SERVICE_URL") ||
      this.configService.get<string>("CHATBOT_SERVICE_URL");
    const internalKey =
      this.configService.get<string>("AI_CHATBOT_INTERNAL_KEY") ||
      this.configService.get<string>("CHATBOT_INTERNAL_KEY");
    const timeoutMs = this.configService.get<number>(
      "CHATBOT_SERVICE_TIMEOUT_MS",
      12000,
    );

    if (!baseUrl) {
      throw new ServiceUnavailableException(
        "AI Chatbot service URL is missing",
      );
    }

    if (!internalKey) {
      throw new ServiceUnavailableException(
        "AI Chatbot internal key is missing",
      );
    }

    return {
      baseUrl,
      internalKey,
      timeoutMs,
    };
  }

  private mapGatewayError(
    error: unknown,
    userId: string,
    startedAt: number,
    action: string,
  ): HttpException {
    const durationMs = Date.now() - startedAt;

    if (error instanceof AxiosError) {
      if (error.response) {
        this.incrementMetricCounter(`${action}_downstream_error`);
        this.logger.error(
          `${action} downstream_error userId=${userId} status=${error.response.status} durationMs=${durationMs}`,
        );
        return new HttpException(
          this.normalizeErrorBody(error.response.data, "Chatbot service error"),
          error.response.status,
        );
      }

      if (error.code === "ECONNABORTED") {
        this.incrementMetricCounter(`${action}_timeout`);
        this.logger.error(
          `${action} timeout userId=${userId} durationMs=${durationMs}`,
        );
        return new GatewayTimeoutException(
          this.createStableErrorBody(
            504,
            "ASSISTANT_GATEWAY_TIMEOUT",
            "Chatbot service timeout",
            true,
          ),
        );
      }

      this.incrementMetricCounter(`${action}_unavailable`);
      this.logger.error(
        `${action} unavailable userId=${userId} code=${error.code} durationMs=${durationMs}`,
      );
      return new ServiceUnavailableException(
        this.createStableErrorBody(
          503,
          "ASSISTANT_GATEWAY_UNAVAILABLE",
          "Chatbot service unavailable",
          true,
        ),
      );
    }

    this.incrementMetricCounter(`${action}_unexpected_error`);
    this.logger.error(
      `${action} unexpected_error userId=${userId} durationMs=${durationMs} reason=${error instanceof Error ? error.message : String(error)}`,
    );
    return new HttpException(
      this.createStableErrorBody(
        500,
        "ASSISTANT_GATEWAY_ERROR",
        "Chatbot gateway error",
        false,
      ),
      500,
    );
  }

  private createStableErrorBody(
    statusCode: number,
    code: string,
    message: string,
    retryable: boolean,
  ) {
    return {
      statusCode,
      code,
      message,
      retryable,
    };
  }

  private metricsEnabled(): boolean {
    return this.configService.get<boolean>("CHATBOT_METRICS_ENABLED", true);
  }

  private incrementMetricCounter(key: string) {
    if (!this.metricsEnabled()) return;
    const current = this.metricsCounters.get(key) ?? 0;
    this.metricsCounters.set(key, current + 1);
  }

  private recordLatency(metric: string, valueMs: number) {
    if (!this.metricsEnabled()) return;
    const windowSize = Math.max(
      10,
      this.configService.get<number>("CHATBOT_METRICS_WINDOW_SIZE", 200),
    );
    const values = this.metricsLatencies.get(metric) ?? [];
    values.push(Math.max(0, Number(valueMs)));
    if (values.length > windowSize) {
      values.shift();
    }
    this.metricsLatencies.set(metric, values);
  }

  private summarizeLatency(metric: string): LatencySummary {
    const values = this.metricsLatencies.get(metric) ?? [];
    if (!values.length) {
      return { count: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    };
  }

  private percentile(sortedValues: number[], percentile: number): number {
    if (!sortedValues.length) return 0;
    const rank = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    const index = Math.max(0, Math.min(rank, sortedValues.length - 1));
    return Math.round(sortedValues[index] * 100) / 100;
  }

  private maybeLogMetricsSnapshot(reason: string) {
    void reason;
    return;
  }

  private normalizeErrorBody(
    value: unknown,
    fallback: string,
  ): string | Record<string, unknown> {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return fallback;
  }
}
