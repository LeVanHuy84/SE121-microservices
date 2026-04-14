import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantMessageDto } from '@repo/dtos';
import axios from 'axios';

type ChatbotResponse = {
  success: boolean;
  data: {
    reply: string;
    sources: Array<{
      type: string;
      id: string;
      title?: string;
      source?: string;
      score?: number;
    }>;
    suggestedActions: Array<{
      type: string;
      label: string;
      payload: Record<string, unknown>;
    }>;
    model: string;
    provider: string;
  };
};

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(private readonly configService: ConfigService) {}

  async respond(userId: string, dto: AssistantMessageDto) {
    const baseUrl = this.configService.get<string>(
      'CHATBOT_SERVICE_URL',
      'http://localhost:4013',
    );
    const internalKey = this.configService.get<string>(
      'CHATBOT_INTERNAL_KEY',
      'chatbot-internal-key-123',
    );
    const timeoutMs = this.configService.get<number>(
      'CHATBOT_SERVICE_TIMEOUT_MS',
      30000,
    );

    try {
      const startedAt = Date.now();
      const res = await axios.post<ChatbotResponse>(
        `${baseUrl}/assistant/respond`,
        {
          userId,
          conversationId: dto.conversationId,
          message: dto.message,
          history: dto.history ?? [],
          contexts: dto.contexts ?? [],
          intent: dto.intent,
        },
        {
          headers: {
            'x-internal-key': internalKey,
          },
          timeout: timeoutMs,
        },
      );

      this.logger.debug(
        `CHATBOT_SERVICE responded: userId=${userId} provider=${res.data?.data?.provider} model=${res.data?.data?.model} durationMs=${Date.now() - startedAt}`,
      );
      return res.data;
    } catch (error) {
      const { status, body, reason } = this.describeFailure(error);
      this.logger.error(
        `CHATBOT_SERVICE failed: userId=${userId} reason=${reason}`,
      );
      throw new HttpException(body, status);
    }
  }

  private describeFailure(error: unknown): {
    status: number;
    body: string | Record<string, unknown>;
    reason: string;
  } {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return {
          status: error.response.status,
          body: this.normalizeErrorBody(
            error.response.data,
            'Chatbot service error',
          ),
          reason: `http_${error.response.status}`,
        };
      }

      if (error.code === 'ECONNABORTED') {
        return {
          status: 504,
          body: 'Chatbot service timeout',
          reason: 'timeout',
        };
      }

      return {
        status: 502,
        body: 'Chatbot service unavailable',
        reason: error.code ?? error.message,
      };
    }

    return {
      status: 500,
      body: 'Chatbot gateway error',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  private normalizeErrorBody(
    value: unknown,
    fallback: string,
  ): string | Record<string, unknown> {
    if (typeof value === 'string') {
      return value;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return fallback;
  }
}
