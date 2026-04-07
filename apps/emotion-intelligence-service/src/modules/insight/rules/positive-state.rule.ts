import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class PositiveStateRule implements InsightRule {
  readonly type = InsightType.POSITIVE_STATE;

  evaluate(context: InsightContext): Insight | null {
    const { recentNegativityScore } = context.profile;
    const { riskLevel } = context.riskState;

    if (!(recentNegativityScore < 0.3 && riskLevel === 'normal')) {
      return null;
    }

    return {
      type: this.type,
      message: 'Bạn đang duy trì trạng thái cảm xúc tích cực',
      tone: InsightTone.POSITIVE,
      priority: 40,
    };
  }
}
