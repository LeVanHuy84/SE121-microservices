import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class RecoveringTrendRule implements InsightRule {
  readonly type = InsightType.RECOVERING_TREND;

  evaluate(context: InsightContext): Insight | null {
    const { emotionMomentum, recentNegativityScore } = context.profile;

    // Recovery trend is surfaced only when recent negativity is still meaningful.
    if (!(emotionMomentum < 0 && recentNegativityScore > 0.4)) {
      return null;
    }

    return {
      type: this.type,
      message: 'Cảm xúc của bạn đang có dấu hiệu cải thiện',
      tone: InsightTone.POSITIVE,
      priority: 60,
    };
  }
}
