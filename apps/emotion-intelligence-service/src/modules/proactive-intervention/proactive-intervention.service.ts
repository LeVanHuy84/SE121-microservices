import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ChannelWrapper } from 'amqp-connection-manager';
import {
  RiskLevel,
  TriggerFlag,
  ProactiveInterventionDto,
  AnalysisResultEventPayload,
  ModerationAction,
  ModerationLabel,
} from '@repo/dtos';

import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UserRiskState,
  UserRiskStateDocument,
} from 'src/mongo/schema/user_risk_states.schema';
import {
  InterventionResource,
  InterventionResourceDocument,
} from 'src/mongo/schema/intervention-resource.schema';
import {
  EmergencyHotline,
  EmergencyHotlineDocument,
} from 'src/mongo/schema/emergency-hotline.schema';
import { IntentSafetyMatcher } from './intent-safety.matcher';
import { InterventionSelectorService } from './intervention-selector.service';
import { MusicClientService } from '../client/music/music-client.service';

@Injectable()
export class ProactiveInterventionService {
  private readonly logger = new Logger(ProactiveInterventionService.name);

  constructor(
    @InjectModel(UserRiskState.name)
    private readonly riskStateModel: Model<UserRiskStateDocument>,
    @InjectModel(InterventionResource.name)
    private readonly resourceModel: Model<InterventionResourceDocument>,
    @InjectModel(EmergencyHotline.name)
    private readonly hotlineModel: Model<EmergencyHotlineDocument>,
    private readonly intentSafetyMatcher: IntentSafetyMatcher,
    private readonly selectorService: InterventionSelectorService,
    @Optional() private readonly musicClientService?: MusicClientService,
    @Optional()
    @Inject('RABBITMQ_CHANNEL')
    private readonly rabbitmqChannel?: ChannelWrapper,
  ) {}

  /**
   * Real-time: Đánh giá và phát tín hiệu can thiệp TỨC THÌ từ Kafka Event payload (<5ms)
   */
  async evaluateFromEvent(
    userId: string,
    payload: AnalysisResultEventPayload,
  ): Promise<ProactiveInterventionDto | null> {
    const rawRiskStr = (payload.mentalHealthRiskLevel || '').toLowerCase();
    const isCrisisOrHighFromAi =
      rawRiskStr === 'critical' || rawRiskStr === 'high';

    const moderation = payload.moderation;
    const isCrisisOrSupportFromModeration =
      moderation &&
      (moderation.action === ModerationAction.ALLOW_WITH_SUPPORT ||
        moderation.label === ModerationLabel.EMOTIONAL_CRISIS ||
        moderation.mentalHealthSupport);

    const hasVlmSelfHarm = (moderation?.violations || []).some(
      (v) => (v.category || '').toUpperCase() === 'SELF_HARM',
    );

    const textToMatch = payload.content || moderation?.displayMessage || '';
    const hasEmergencyKeywords =
      this.intentSafetyMatcher.matchesEmergencyIntent(textToMatch);

    let riskLevel = RiskLevel.NORMAL;
    const triggers: TriggerFlag[] = [];

    if (hasEmergencyKeywords || hasVlmSelfHarm) {
      riskLevel = RiskLevel.CRISIS;
      triggers.push(TriggerFlag.SUICIDAL_IDEATION);
    } else if (isCrisisOrHighFromAi || isCrisisOrSupportFromModeration) {
      riskLevel = RiskLevel.HIGH_RISK;
      triggers.push(TriggerFlag.LONG_TERM_SADNESS);
    }

    if (riskLevel === RiskLevel.NORMAL) {
      return null;
    }

    const primaryEmotion =
      (payload as any).emotions?.primaryEmotion ||
      (payload as any).primaryEmotion;

    const emotionVector =
      (payload as any).emotions?.scores ||
      (payload as any).emotionVector;

    const intervention = await this.buildInterventionResponse(
      userId,
      riskLevel,
      riskLevel === RiskLevel.CRISIS ? 0.95 : 0.8,
      triggers,
      textToMatch,
      primaryEmotion,
      emotionVector,
    );

    if (intervention) {
      await this.persistAndEmitIntervention(userId, intervention);
    }

    return intervention;
  }

  /**
   * Cron Evaluation: Đánh giá user thụ động (Cron Job)
   */
  async evaluatePassiveUser(
    userId: string,
  ): Promise<ProactiveInterventionDto | null> {
    const riskState = await this.riskStateModel.findOne({ userId }).exec();
    if (!riskState || riskState.riskLevel === RiskLevel.NORMAL) {
      return null;
    }

    if (
      this.isSpamCooldownActive(
        riskState.riskLevel,
        riskState.lastInterventionAt,
      )
    ) {
      return null;
    }

    const intervention = await this.buildInterventionResponse(
      userId,
      riskState.riskLevel,
      riskState.riskScore,
      riskState.riskTriggers as any,
    );

    if (intervention) {
      await this.persistAndEmitIntervention(userId, intervention);
    }

    return intervention;
  }

  /**
   * Phản hồi can thiệp cấu trúc động từ MongoDB kết hợp Groq AI Selection Engine
   */
  async buildInterventionResponse(
    userId: string,
    riskLevel: RiskLevel,
    riskScore: number,
    triggers: TriggerFlag[] = [],
    content?: string,
    primaryEmotion?: string,
    emotionVector?: Record<string, number>,
  ): Promise<ProactiveInterventionDto | null> {
    const timestamp = new Date();

    switch (riskLevel) {
      case RiskLevel.NORMAL:
        return null;

      case RiskLevel.MILD_STRESS: {
        const musicSuggestions = this.musicClientService
          ? await this.musicClientService.getRelaxingMusicBySignal(
              undefined,
              riskLevel,
              5,
            )
          : [];

        return {
          userId,
          riskLevel,
          riskScore,
          triggers,
          suggestedAction: 'PLAYLIST_AND_TIPS',
          musicSuggestions,
          timestamp,
        };
      }

      case RiskLevel.MODERATE_RISK:
      case RiskLevel.HIGH_RISK: {
        const availableResources = await this.resourceModel
          .find({
            targetRiskLevels: riskLevel,
            isActive: true,
          })
          .exec();

        const selectedResource = await this.selectorService.selectBestResource(
          availableResources,
          {
            userId,
            riskLevel,
            riskScore,
            triggers,
            content,
            primaryEmotion,
            emotionVector,
          },
        );

        return {
          userId,
          riskLevel,
          riskScore,
          triggers,
          suggestedAction: 'MEDICAL_DOCUMENT',
          resource: selectedResource
            ? {
                id: selectedResource._id.toString(),
                title: selectedResource.title,
                description: selectedResource.description,
                targetRiskLevels: selectedResource.targetRiskLevels,
                mediaType: selectedResource.mediaType,
                mediaUrl: selectedResource.mediaUrl,
                sourceOrganization: selectedResource.sourceOrganization,
                referenceUrl: selectedResource.referenceUrl,
                thumbnailUrl: selectedResource.thumbnailUrl,
              }
            : undefined,
          chatbotPromptContext:
            'Chúng mình nhận thấy dạo này bạn có nhiều tâm sự u buồn. Trợ lý AI sẵn sàng lắng nghe và chia sẻ cùng bạn bất cứ lúc nào.',
          timestamp,
        };
      }

      case RiskLevel.CRISIS: {
        const hotlines = await this.hotlineModel
          .find({ isActive: true })
          .exec();

        const { primary, secondary } =
          this.selectorService.dispatchHotlines(hotlines);

        return {
          userId,
          riskLevel,
          riskScore,
          triggers,
          suggestedAction: 'CRISIS_HOTLINE',
          hotlineInfo: {
            number: primary ? primary.hotlineNumber : '115',
            organization: primary
              ? primary.organizationName
              : 'Cấp cứu Khẩn cấp 115',
            operatingHours: (primary && primary.operatingHours) ? primary.operatingHours : '24/7',
            primaryHotline: primary
              ? {
                  id: primary._id.toString(),
                  organizationName: primary.organizationName,
                  hotlineNumber: primary.hotlineNumber,
                  is247: primary.is247,
                  operatingHours: primary.operatingHours || '24/7',
                  operatingHoursConfig: primary.operatingHoursConfig,
                  description: primary.description,
                  websiteUrl: primary.websiteUrl,
                  isPrimary: primary.isPrimary,
                }
              : undefined,
            secondaryHotlines: secondary.map((sec) => ({
              id: sec._id.toString(),
              organizationName: sec.organizationName,
              hotlineNumber: sec.hotlineNumber,
              is247: sec.is247,
              operatingHours: sec.operatingHours || '24/7',
              operatingHoursConfig: sec.operatingHoursConfig,
              description: sec.description,
              websiteUrl: sec.websiteUrl,
              isPrimary: sec.isPrimary,
            })),
          },
          chatbotPromptContext:
            'Nếu bạn đang trải qua cảm giác quá sức, xin hãy nhớ rằng luôn có sự hỗ trợ sẵn sàng dành cho bạn.',
          timestamp,
        };
      }

      default:
        return null;
    }
  }

  /**
   * Lưu trạng thái can thiệp và phát sự kiện Kafka PROACTIVE_INTERVENTION
   */
  private async persistAndEmitIntervention(
    userId: string,
    result: ProactiveInterventionDto,
  ): Promise<void> {
    await this.riskStateModel.updateOne(
      { userId },
      {
        $set: {
          lastInterventionAt: result.timestamp,
          lastInterventionType: result.suggestedAction,
        },
      },
    );

    if (this.rabbitmqChannel) {
      try {
        await this.rabbitmqChannel.publish(
          'notification',
          'proactive.intervention',
          result,
        );
        this.logger.log(
          `Published PROACTIVE_INTERVENTION to RabbitMQ (notification exchange) for user=${userId}`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to publish PROACTIVE_INTERVENTION to RabbitMQ for user=${userId}`,
          err,
        );
      }
    }
  }

  /**
   * Kiểm tra Cooldown chống Spam thông báo
   */
  private isSpamCooldownActive(
    riskLevel: RiskLevel,
    lastInterventionAt?: Date,
  ): boolean {
    if (!lastInterventionAt) {
      return false;
    }

    const lastTime = new Date(lastInterventionAt).getTime();
    const now = Date.now();
    const elapsedMinutes = (now - lastTime) / (1000 * 60);

    if (riskLevel === RiskLevel.CRISIS) {
      return elapsedMinutes < 15;
    }

    if (
      riskLevel === RiskLevel.MILD_STRESS ||
      riskLevel === RiskLevel.MODERATE_RISK
    ) {
      return elapsedMinutes < 120;
    }

    if (riskLevel === RiskLevel.HIGH_RISK) {
      return elapsedMinutes < 60;
    }

    return false;
  }
}
