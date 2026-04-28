import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

import {
  AssistantContextItemDto,
  AssistantMessageDto,
  AssistantRespondDataDto,
  AssistantRespondResponseDto,
  ChatbotClearHistoryResponseDto,
  ChatbotHistoryResponseDto,
} from '@repo/dtos';
import { AssistantContextService } from './assistant-context.service';

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
  private readonly respondCache = new Map<string, RespondCacheEntry>();
  private readonly respondInflight = new Map<
    string,
    Promise<AssistantRespondDataDto>
  >();
  private readonly metricsLatencies = new Map<string, number[]>();
  private readonly metricsCounters = new Map<string, number>();
  private metricsRespondCount = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly contextService: AssistantContextService,
  ) {}

  async respond(
    userId: string,
    dto: AssistantMessageDto,
  ): Promise<AssistantRespondDataDto> {
    const startedAt = Date.now();
    const { baseUrl, internalKey, timeoutMs } = this.resolveClientConfig();
    const normalizedMessage = this.normalizeMessage(dto.message);
    const cacheKey = this.buildRespondCacheKey(userId, normalizedMessage);
    const contextTimeoutMs = this.configService.get<number>(
      'CHATBOT_CONTEXT_BUILD_TIMEOUT_MS',
      1200,
    );
    const cacheEnabled = this.configService.get<boolean>(
      'CHATBOT_RESPOND_CACHE_ENABLED',
      false,
    );
    const inflightDedupEnabled = this.configService.get<boolean>(
      'CHATBOT_RESPOND_INFLIGHT_DEDUP_ENABLED',
      true,
    );
    const cacheTtlMs = this.configService.get<number>(
      'CHATBOT_RESPOND_CACHE_TTL_MS',
      20000,
    );

    if (cacheEnabled) {
      const cached = this.getCachedRespond(cacheKey);
      if (cached) {
        this.incrementMetricCounter('respond_cache_hit');
        this.recordLatency('respond.total_ms', Date.now() - startedAt);
        this.maybeLogMetricsSnapshot('cache_hit');
        return cached;
      }
    }

    if (inflightDedupEnabled) {
      const inflight = this.respondInflight.get(cacheKey);
      if (inflight) {
        this.incrementMetricCounter('respond_inflight_join');
        this.recordLatency('respond.total_ms', Date.now() - startedAt);
        this.maybeLogMetricsSnapshot('inflight_join');
        return await inflight;
      }
    }

    const execution = this.executeRespond({
      userId,
      message: dto.message,
      normalizedMessage,
      baseUrl,
      internalKey,
      timeoutMs,
      contextTimeoutMs,
      startedAt,
    });

    if (inflightDedupEnabled) {
      this.respondInflight.set(cacheKey, execution);
      try {
        const result = await execution;
        if (cacheEnabled) {
          this.setCachedRespond(cacheKey, result, cacheTtlMs);
        }
        return result;
      } catch (error) {
        throw this.mapGatewayError(error, userId, startedAt, 'assistant.respond');
      } finally {
        this.respondInflight.delete(cacheKey);
      }
    }

    try {
      const result = await execution;
      if (cacheEnabled) {
        this.setCachedRespond(cacheKey, result, cacheTtlMs);
      }
      return result;
    } catch (error) {
      throw this.mapGatewayError(error, userId, startedAt, 'assistant.respond');
    }
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
              'x-internal-key': internalKey,
            },
            params,
            timeout: timeoutMs,
          },
        ),
      );

      return res.data.data;
    } catch (error) {
      throw this.mapGatewayError(error, userId, startedAt, 'assistant.history.get');
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
              'x-internal-key': internalKey,
            },
            timeout: timeoutMs,
          },
        ),
      );

      this.clearRespondCacheByUser(userId);
      return res.data.data;
    } catch (error) {
      throw this.mapGatewayError(
        error,
        userId,
        startedAt,
        'assistant.history.clear',
      );
    }
  }

  private async executeRespond(params: {
    userId: string;
    message: string;
    normalizedMessage: string;
    baseUrl: string;
    internalKey: string;
    timeoutMs: number;
    contextTimeoutMs: number;
    startedAt: number;
  }): Promise<AssistantRespondDataDto> {
    const {
      userId,
      message,
      normalizedMessage,
      baseUrl,
      internalKey,
      timeoutMs,
      contextTimeoutMs,
      startedAt,
    } = params;

    const contextsStartedAt = Date.now();
    const contexts = await this.resolveContextsWithinBudget(
      userId,
      message,
      contextTimeoutMs,
    );
    const contextsDurationMs = Date.now() - contextsStartedAt;
    const elapsedMs = Date.now() - startedAt;
    const minDownstreamTimeoutMs = this.configService.get<number>(
      'CHATBOT_DOWNSTREAM_MIN_TIMEOUT_MS',
      1000,
    );
    const remainingBudgetMs = Math.max(
      minDownstreamTimeoutMs,
      timeoutMs - elapsedMs,
    );

    const downstreamStartedAt = Date.now();
    const res = await firstValueFrom(
      this.httpService.post<AssistantRespondResponseDto>(
        `${baseUrl}/assistant/respond`,
        {
          userId,
          message,
          contexts,
        },
        {
          headers: {
            'x-internal-key': internalKey,
          },
          timeout: remainingBudgetMs,
        },
      ),
    );
    const downstreamDurationMs = Date.now() - downstreamStartedAt;
    const totalDurationMs = Date.now() - startedAt;

    this.incrementMetricCounter('respond_success');
    this.recordLatency('respond.context_ms', contextsDurationMs);
    this.recordLatency('respond.downstream_ms', downstreamDurationMs);
    this.recordLatency('respond.total_ms', totalDurationMs);
    this.maybeLogMetricsSnapshot('respond_success');

    return res.data.data;
  }

  private async resolveContextsWithinBudget(
    userId: string,
    message: string,
    timeoutMs: number,
  ): Promise<AssistantContextItemDto[]> {
    return await new Promise<AssistantContextItemDto[]>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.logger.warn(
          `assistant.context timeout userId=${userId} timeoutMs=${timeoutMs}`,
        );
        resolve([]);
      }, Math.max(timeoutMs, 1));

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

  private buildRespondCacheKey(userId: string, normalizedMessage: string): string {
    return `${userId}:${normalizedMessage}`;
  }

  private normalizeMessage(message: string): string {
    return String(message ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private getCachedRespond(key: string): AssistantRespondDataDto | null {
    const entry = this.respondCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.respondCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCachedRespond(
    key: string,
    value: AssistantRespondDataDto,
    ttlMs: number,
  ) {
    const maxEntries = this.configService.get<number>(
      'CHATBOT_RESPOND_CACHE_MAX_ENTRIES',
      1000,
    );
    this.evictExpiredRespondCache();
    if (this.respondCache.size >= maxEntries) {
      const oldestKey = this.respondCache.keys().next().value;
      if (typeof oldestKey === 'string') {
        this.respondCache.delete(oldestKey);
      }
    }

    this.respondCache.set(key, {
      value,
      expiresAt: Date.now() + Math.max(1000, ttlMs),
    });
  }

  private clearRespondCacheByUser(userId: string) {
    const prefix = `${userId}:`;
    for (const key of this.respondCache.keys()) {
      if (key.startsWith(prefix)) {
        this.respondCache.delete(key);
      }
    }
  }

  private evictExpiredRespondCache() {
    const now = Date.now();
    for (const [key, entry] of this.respondCache.entries()) {
      if (entry.expiresAt <= now) {
        this.respondCache.delete(key);
      }
    }
  }

  private resolveClientConfig() {
    const baseUrl = this.configService.get<string>('CHATBOT_SERVICE_URL');
    const internalKey = this.configService.get<string>('CHATBOT_INTERNAL_KEY');
    const timeoutMs = this.configService.get<number>(
      'CHATBOT_SERVICE_TIMEOUT_MS',
      12000,
    );

    if (!baseUrl) {
      throw new ServiceUnavailableException('Chatbot service URL is missing');
    }

    if (!internalKey) {
      throw new ServiceUnavailableException('Chatbot internal key is missing');
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
          this.normalizeErrorBody(error.response.data, 'Chatbot service error'),
          error.response.status,
        );
      }

      if (error.code === 'ECONNABORTED') {
        this.incrementMetricCounter(`${action}_timeout`);
        this.logger.error(
          `${action} timeout userId=${userId} durationMs=${durationMs}`,
        );
        return new GatewayTimeoutException('Chatbot service timeout');
      }

      this.incrementMetricCounter(`${action}_unavailable`);
      this.logger.error(
        `${action} unavailable userId=${userId} code=${error.code} durationMs=${durationMs}`,
      );
      return new ServiceUnavailableException('Chatbot service unavailable');
    }

    this.incrementMetricCounter(`${action}_unexpected_error`);
    this.logger.error(
      `${action} unexpected_error userId=${userId} durationMs=${durationMs} reason=${error instanceof Error ? error.message : String(error)}`,
    );
    return new HttpException('Chatbot gateway error', 500);
  }

  private metricsEnabled(): boolean {
    return this.configService.get<boolean>('CHATBOT_METRICS_ENABLED', true);
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
      this.configService.get<number>('CHATBOT_METRICS_WINDOW_SIZE', 200),
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
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return fallback;
  }
}
