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
  AssistantMessageDto,
  AssistantRespondResponseDto,
  ChatbotClearHistoryResponseDto,
  ChatbotHistoryResponseDto,
} from '@repo/dtos';
import { AssistantContextService } from './assistant-context.service';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly contextService: AssistantContextService,
  ) {}

  async respond(userId: string, dto: AssistantMessageDto) {
    const startedAt = Date.now();
    const { baseUrl, internalKey, timeoutMs } = this.resolveClientConfig();

    try {
      const contexts = await this.contextService.buildContexts(
        userId,
        dto.message,
      );

      const res = await firstValueFrom(
        this.httpService.post<AssistantRespondResponseDto>(
          `${baseUrl}/assistant/respond`,
          {
            userId,
            message: dto.message,
            contexts,
          },
          {
            headers: {
              'x-internal-key': internalKey,
            },
            timeout: timeoutMs,
          },
        ),
      );

      this.logger.log(
        `assistant.respond ok userId=${userId} contexts=${contexts.length} durationMs=${Date.now() - startedAt}`,
      );

      return res.data;
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

      this.logger.log(
        `assistant.history.get ok userId=${userId} pageSize=${pageSize ?? 'default'} durationMs=${Date.now() - startedAt}`,
      );
      return res.data;
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

      this.logger.log(
        `assistant.history.clear ok userId=${userId} durationMs=${Date.now() - startedAt}`,
      );
      return res.data;
    } catch (error) {
      throw this.mapGatewayError(
        error,
        userId,
        startedAt,
        'assistant.history.clear',
      );
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
        this.logger.error(
          `${action} downstream_error userId=${userId} status=${error.response.status} durationMs=${durationMs}`,
        );
        return new HttpException(
          this.normalizeErrorBody(error.response.data, 'Chatbot service error'),
          error.response.status,
        );
      }

      if (error.code === 'ECONNABORTED') {
        this.logger.error(
          `${action} timeout userId=${userId} durationMs=${durationMs}`,
        );
        return new GatewayTimeoutException('Chatbot service timeout');
      }

      this.logger.error(
        `${action} unavailable userId=${userId} code=${error.code} durationMs=${durationMs}`,
      );
      return new ServiceUnavailableException('Chatbot service unavailable');
    }

    this.logger.error(
      `${action} unexpected_error userId=${userId} durationMs=${durationMs} reason=${error instanceof Error ? error.message : String(error)}`,
    );
    return new HttpException('Chatbot gateway error', 500);
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
