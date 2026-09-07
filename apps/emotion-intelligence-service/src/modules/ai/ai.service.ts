import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CreateNotificationDto,
  EmotionTimeWindow,
  NotiTargetType,
  RiskLevel,
} from '@repo/dtos';
import { NotificationService } from '@repo/common';
import { Model } from 'mongoose';
import {
  UserEmotionSnapshot,
  UserEmotionSnapshotDocument,
} from 'src/mongo/schema/emotion-snapshot.schema';
import {
  UserEmotionProfile,
  UserEmotionProfileDocument,
} from 'src/mongo/schema/emotion-profile.schema';
import {
  UserRiskState,
  UserRiskStateDocument,
} from 'src/mongo/schema/user_risk_states.schema';
import { mapAiContext } from './ai.mapper';
import { buildSystemPrompt, buildUserPrompt } from './ai.prompt';
import { AiContext, RiskDetectedEvent } from './ai.types';

interface GroqChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const FALLBACK_ADVICE =
  'Bạn đang trải qua một số cảm xúc không dễ chịu. Hãy thử nghỉ ngơi một chút và chia sẻ với người bạn tin tưởng.';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectModel(UserEmotionSnapshot.name)
    private readonly snapshotModel: Model<UserEmotionSnapshotDocument>,
    @InjectModel(UserEmotionProfile.name)
    private readonly profileModel: Model<UserEmotionProfileDocument>,
    @InjectModel(UserRiskState.name)
    private readonly riskStateModel: Model<UserRiskStateDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  async handleRiskEvent(event: RiskDetectedEvent): Promise<void> {
    const context = await this.buildContext(event);
    const advice = await this.generateAdvice(context);

    this.logger.log(
      `AI advice generated user=${event.userId} risk=${context.riskLevel} score=${context.riskScore.toFixed(3)}`,
    );
    this.logger.debug(`AI advice content user=${event.userId}: ${advice}`);

    this.emitAdviceNotification(event.userId, context.riskLevel, advice);
  }

  async buildContext(event: RiskDetectedEvent): Promise<AiContext> {
    const [snapshot, profile, riskState] = await Promise.all([
      this.snapshotModel
        .findOne(
          {
            userId: event.userId,
            window: EmotionTimeWindow.ONE_DAY,
          },
          {
            _id: 0,
            negativeRatio: 1,
            baselineNegativeRatio: 1,
            emotionVolatility: 1,
            trend: 1,
          },
        )
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.profileModel
        .findOne(
          { userId: event.userId },
          {
            _id: 0,
            recentNegativityScore: 1,
            negativeEventStreak: 1,
            lastEventAt: 1,
            lastStrongNegativeAt: 1,
          },
        )
        .lean()
        .exec(),
      this.riskStateModel
        .findOne(
          { userId: event.userId },
          {
            _id: 0,
            userId: 1,
            riskLevel: 1,
            riskScore: 1,
            stableWindows: 1,
            previousRiskScore: 1,
            lastNotifiedAt: 1,
            lastEvaluatedAt: 1,
          },
        )
        .lean()
        .exec(),
    ]);

    return mapAiContext({ event, snapshot, profile, riskState });
  }

  async generateAdvice(context: AiContext): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      this.logger.warn('GROQ_API_KEY is missing; using fallback advice');
      return FALLBACK_ADVICE;
    }

    const model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(context);

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.4,
            max_tokens: 150,
          }),
        },
      );

      if (response.status === 429) {
        this.logger.warn(
          `Groq rate limited userRisk=${context.riskLevel} score=${context.riskScore.toFixed(3)}`,
        );
        return FALLBACK_ADVICE;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Groq request failed status=${response.status} body=${errorBody}`,
        );
        return FALLBACK_ADVICE;
      }

      const data = (await response.json()) as GroqChatResponse;
      const content = data.choices?.[0]?.message?.content?.trim() ?? '';

      if (!content) {
        this.logger.warn('Groq response empty; using fallback advice');
        return FALLBACK_ADVICE;
      }

      return this.enforceSafety(content);
    } catch (error) {
      this.logger.error(
        `Groq advice generation error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return FALLBACK_ADVICE;
    }
  }

  private emitAdviceNotification(
    userId: string,
    riskLevel: RiskLevel,
    advice: string,
  ): void {
    const dto: CreateNotificationDto = {
      requestId: `risk-advice-${userId}-${Date.now()}`,
      userId,
      type: 'RISK_ADVICE',
      payload: {
        targetType: NotiTargetType.SYSTEM_ALERT,
        targetId: userId,
        actorAvatar:
          'https://res.cloudinary.com/dyxdfvpgi/image/upload/v1775124047/ChatGPT_Image_16_58_03_2_thg_4_2026_tw9mx1.png',
        actorName: 'Sentimeta',
        content: advice,
      },
      channels: [],
      sendAt: new Date(),
      meta: {
        priority: this.mapPriority(riskLevel),
        maxRetries: 3,
      },
    };

    void this.notificationService
      .sendNotification(dto)
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to emit risk advice notification user=${userId}`,
          error instanceof Error ? error.stack : String(error),
        );
      });
  }

  private mapPriority(riskLevel: RiskLevel): number {
    switch (riskLevel) {
      case RiskLevel.CRISIS:
        return 5;
      case RiskLevel.HIGH_RISK:
        return 4;
      case RiskLevel.MODERATE_RISK:
        return 3;
      case RiskLevel.MILD_STRESS:
        return 2;
      default:
        return 1;
    }
  }

  private enforceSafety(advice: string): string {
    const normalized = advice.toLowerCase();
    const blockedPatterns = [
      // direct
      /tự\s*tử/i,
      /tự\s*hại/i,
      /gây\s*hại\s*bản\s*thân/i,

      // indirect (rất quan trọng)
      /biến\s*mất/i,
      /không\s*muốn\s*tồn\s*tại/i,
      /kết\s*thúc\s*(mọi\s*)?thứ/i,

      // diagnosis
      /trầm\s*cảm/i,
      /chẩn\s*đoán/i,
    ];

    if (blockedPatterns.some((pattern) => pattern.test(normalized))) {
      this.logger.warn('Unsafe advice detected; fallback applied');
      return FALLBACK_ADVICE;
    }

    return advice;
  }
}
