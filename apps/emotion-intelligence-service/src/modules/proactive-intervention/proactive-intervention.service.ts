import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  RiskLevel,
  TriggerFlag,
  ProactiveInterventionDto,
  BreathingExerciseDto,
  AnalysisResultEventPayload,
  EventTopic,
} from '@repo/dtos';
import { KafkaProducerService } from '@repo/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UserRiskState,
  UserRiskStateDocument,
} from 'src/mongo/schema/user_risk_states.schema';
import { IntentSafetyMatcher } from './intent-safety.matcher';
import { MusicClientService } from '../client/music/music-client.service';

@Injectable()
export class ProactiveInterventionService {
  private readonly logger = new Logger(ProactiveInterventionService.name);

  constructor(
    @InjectModel(UserRiskState.name)
    private readonly riskStateModel: Model<UserRiskStateDocument>,
    private readonly intentSafetyMatcher: IntentSafetyMatcher,
    @Optional() private readonly musicClientService?: MusicClientService,
    @Optional() private readonly kafkaProducerService?: KafkaProducerService,
  ) {}

  /**
   * Real-time: Đánh giá và phát tín hiệu can thiệp TỨC THÌ từ Kafka Event payload (<5ms)
   */
  async evaluateFromEvent(
    userId: string,
    payload: AnalysisResultEventPayload,
  ): Promise<ProactiveInterventionDto | null> {
    // 1. Strict Intent Safety Matcher: Bắt buộc khớp từ khóa Regex tự hại / tự sát khẩn cấp
    const isEmergencyText = this.intentSafetyMatcher.evaluateEmergencySafety(
      payload.targetId || '',
      payload,
    );

    const existingState = await this.riskStateModel
      .findOne({ userId })
      .lean<UserRiskState>()
      .exec();

    let riskLevel = existingState?.riskLevel || RiskLevel.NORMAL;
    let riskScore = existingState?.riskScore || 0;
    const triggers = existingState?.riskTriggers || [];

    if (isEmergencyText) {
      riskLevel = RiskLevel.CRISIS;
      riskScore = 1.0;
      if (!triggers.includes(TriggerFlag.SUICIDAL_IDEATION)) {
        triggers.push(TriggerFlag.SUICIDAL_IDEATION);
      }
    }

    const result = await this.evaluateIntervention(
      userId,
      riskLevel,
      riskScore,
      triggers,
      existingState?.lastInterventionAt,
      payload.scores,
    );

    if (result) {
      await this.persistAndEmitIntervention(userId, result);
    }

    return result;
  }

  /**
   * Passive Sweep: Đánh giá và hỗ trợ người dùng thụ động u buồn kéo dài (cho CronJob)
   */
  async evaluatePassiveUser(
    userId: string,
  ): Promise<ProactiveInterventionDto | null> {
    const existingState = await this.riskStateModel
      .findOne({ userId })
      .lean<UserRiskState>()
      .exec();

    if (!existingState) return null;

    const result = await this.evaluateIntervention(
      userId,
      existingState.riskLevel,
      existingState.riskScore,
      existingState.riskTriggers || [],
      existingState.lastInterventionAt,
    );

    if (result) {
      await this.persistAndEmitIntervention(userId, result);
    }

    return result;
  }

  /**
   * Tạo payload gợi ý can thiệp chủ động dựa vào trạng thái rủi ro
   */
  async evaluateIntervention(
    userId: string,
    riskLevel: RiskLevel,
    riskScore: number,
    triggers: TriggerFlag[],
    lastInterventionAt?: Date,
    emotionVector?: Record<string, number>,
  ): Promise<ProactiveInterventionDto | null> {
    // 1. Kiểm tra Cooldown chống Spam (Notification Fatigue Guard)
    if (this.isSpamCooldownActive(riskLevel, lastInterventionAt)) {
      this.logger.debug(
        `Intervention suppressed due to cooldown for user ${userId} (${riskLevel})`,
      );
      return null;
    }

    const timestamp = new Date();

    switch (riskLevel) {
      case RiskLevel.NORMAL:
        return null; // Không can thiệp

      case RiskLevel.MILD_STRESS: {
        const musicSuggestions = this.musicClientService
          ? await this.musicClientService.getRelaxingMusicBySignal(
              emotionVector,
              riskLevel,
              5,
            )
          : [
              {
                title: 'Lo-Fi Chill & Relax',
                artist: 'Healing Sounds',
                moodTarget: 'calm',
                genre: 'lofi',
              },
              {
                title: 'Nhạc Không Lời Xoa Dịu Tâm Trạng',
                artist: 'Acoustic Peace',
                moodTarget: 'peaceful',
                genre: 'acoustic',
              },
            ];

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
        return {
          userId,
          riskLevel,
          riskScore,
          triggers,
          suggestedAction: 'BREATHING_AND_JOURNAL',
          breathingExercise: this.getBreathing478(),
          journalingPrompt:
            'Hãy dành vài phút lắng lại: Điều gì đang khiến bạn trăn trở hôm nay? Viết ra sẽ giúp tâm trí bạn nhẹ nhàng hơn.',
          timestamp,
        };

      // TODO: Giai đoạn sau - Cần chuyển các chuỗi prompt, cấu hình hotline và thông điệp can thiệp về hệ thống quản lý tài nguyên/config động (Dynamic CMS / Admin Database) thay vì mock cứng trong code.
      case RiskLevel.HIGH_RISK:
        return {
          userId,
          riskLevel,
          riskScore,
          triggers,
          suggestedAction: 'CHATBOT_COMPANION',
          breathingExercise: this.getBreathing478(),
          chatbotPromptContext:
            'Chúng mình nhận thấy dạo này bạn có nhiều tâm sự u buồn. Trợ lý AI sẵn sàng lắng nghe và chia sẻ cùng bạn bất cứ lúc nào.',
          timestamp,
        };

      // TODO: Giai đoạn sau - Cấu hình thông tin Đường dây nóng Hotline khẩn cấp từ Admin Config / System Settings DB.
      case RiskLevel.CRISIS:
        return {
          userId,
          riskLevel,
          riskScore,
          triggers,
          suggestedAction: 'CRISIS_HOTLINE',
          hotlineInfo: {
            number: '1900.xxx.xxx (Hoặc 115)',
            organization: 'Đường dây nóng Hỗ trợ Sức khỏe Tinh thần Khẩn cấp',
            operatingHours: '24/7',
          },
          chatbotPromptContext:
            'Nếu bạn đang trải qua cảm giác quá sức, xin hãy nhớ rằng luôn có sự hỗ trợ sẵn sàng dành cho bạn.',
          timestamp,
        };

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

    if (this.kafkaProducerService) {
      try {
        await this.kafkaProducerService.sendMessage(
          EventTopic.PROACTIVE_INTERVENTION,
          result,
          userId,
        );
        this.logger.log(
          `Emitted PROACTIVE_INTERVENTION event for user=${userId} (action=${result.suggestedAction})`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to emit PROACTIVE_INTERVENTION event for user=${userId}`,
          err,
        );
      }
    }
  }

  /**
   * Bài tập thở 4-7-8 chuẩn y khoa hạ nhịp tim (Russell Circumplex Model)
   */
  private getBreathing478(): BreathingExerciseDto {
    return {
      name: 'Bài tập thở sâu 4-7-8 xoa dịu lo âu',
      technique: '4-7-8',
      inhaleSeconds: 4,
      holdSeconds: 7,
      exhaleSeconds: 8,
      cycles: 4,
      guideMessage:
        'Hít vào bằng mũi (4s) -> Giữ hơi thở (7s) -> Thở ra từ từ bằng miệng (8s). Lặp lại 4 chu kỳ.',
    };
  }

  /**
   * Kiểm tra Cooldown: Mild/Moderate: 24h, High: 12h, Crisis: Không cooldown
   */
  private isSpamCooldownActive(
    riskLevel: RiskLevel,
    lastInterventionAt?: Date,
  ): boolean {
    if (!lastInterventionAt || riskLevel === RiskLevel.CRISIS) {
      return false; // CRISIS luôn luôn được hiển thị
    }

    const now = new Date().getTime();
    const lastTime = new Date(lastInterventionAt).getTime();
    const diffHours = (now - lastTime) / (1000 * 60 * 60);

    if (
      riskLevel === RiskLevel.MILD_STRESS ||
      riskLevel === RiskLevel.MODERATE_RISK
    ) {
      return diffHours < 24; // 24 giờ
    }

    if (riskLevel === RiskLevel.HIGH_RISK) {
      return diffHours < 12; // 12 giờ
    }

    return false;
  }
}
