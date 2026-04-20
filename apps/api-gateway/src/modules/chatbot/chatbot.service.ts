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

import { AssistantMessageDto, AssistantRespondResponseDto } from '@repo/dtos';
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
      throw this.mapGatewayError(error, userId, startedAt);
    }
  }

  private mapGatewayError(
    error: unknown,
    userId: string,
    startedAt: number,
  ): HttpException {
    const durationMs = Date.now() - startedAt;

    if (error instanceof AxiosError) {
      if (error.response) {
        this.logger.error(
          `assistant.respond downstream_error userId=${userId} status=${error.response.status} durationMs=${durationMs}`,
        );
        return new HttpException(
          this.normalizeErrorBody(error.response.data, 'Chatbot service error'),
          error.response.status,
        );
      }

      if (error.code === 'ECONNABORTED') {
        this.logger.error(
          `assistant.respond timeout userId=${userId} durationMs=${durationMs}`,
        );
        return new GatewayTimeoutException('Chatbot service timeout');
      }

      this.logger.error(
        `assistant.respond unavailable userId=${userId} code=${error.code} durationMs=${durationMs}`,
      );
      return new ServiceUnavailableException('Chatbot service unavailable');
    }

    this.logger.error(
      `assistant.respond unexpected_error userId=${userId} durationMs=${durationMs} reason=${error instanceof Error ? error.message : String(error)}`,
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
