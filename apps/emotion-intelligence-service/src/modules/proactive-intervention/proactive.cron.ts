import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UserRiskState,
  UserRiskStateDocument,
} from 'src/mongo/schema/user_risk_states.schema';
import { RiskLevel } from '@repo/dtos';
import { ProactiveInterventionService } from './proactive-intervention.service';

const PROACTIVE_CRON_EXPRESSION =
  process.env.PROACTIVE_SWEEP_CRON || CronExpression.EVERY_DAY_AT_9AM;

@Injectable()
export class ProactiveCron {
  private readonly logger = new Logger(ProactiveCron.name);

  constructor(
    @InjectModel(UserRiskState.name)
    private readonly riskStateModel: Model<UserRiskStateDocument>,
    private readonly proactiveInterventionService: ProactiveInterventionService,
  ) {}

  /**
   * Daily Maintenance Cron Sweep (Mặc định 09:00 AM UTC hoặc qua biến môi trường PROACTIVE_SWEEP_CRON):
   * Quét và hỗ trợ những người dùng thụ động (Passive Users) có tâm trạng u buồn/rủi ro kéo dài
   * nhưng không phát sinh bài đăng hay sự kiện mới nào để kích hoạt real-time handler.
   */
  @Cron(PROACTIVE_CRON_EXPRESSION, { timeZone: 'UTC' })
  async runDailyProactiveSweep(): Promise<void> {
    this.logger.log(
      'Starting daily proactive intervention sweep for passive prolonged risk profiles...',
    );

    try {
      const activeRiskUsers = await this.riskStateModel
        .find({
          riskLevel: {
            $in: [
              RiskLevel.MILD_STRESS,
              RiskLevel.MODERATE_RISK,
              RiskLevel.HIGH_RISK,
              RiskLevel.CRISIS,
            ],
          },
        })
        .exec();

      let interventionCount = 0;

      for (const userRiskDoc of activeRiskUsers) {
        const userId = userRiskDoc.userId;
        const result =
          await this.proactiveInterventionService.evaluatePassiveUser(userId);

        if (result) {
          interventionCount++;
        }
      }

      this.logger.log(
        `Daily proactive sweep finished. Sent intervention suggestions to ${interventionCount} passive users out of ${activeRiskUsers.length} active risk profiles.`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to execute daily proactive intervention sweep',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
