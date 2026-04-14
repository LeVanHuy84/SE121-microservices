import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class DeterioratingTrendRule implements InsightRule {
  readonly type = InsightType.DETERIORATING_TREND;

  evaluate(context: InsightContext): Insight | null {
    const { emotionMomentum, recentNegativityScore } = context.profile;

    // Trend is only meaningful when paired with sufficient negativity context.
    if (!(emotionMomentum > 0 && recentNegativityScore > 0.4)) {
      return null;
    }

    return {
      type: this.type,
      message: 'Cảm xúc của bạn đang có xu hướng xấu đi',
      tone: InsightTone.WARNING,
      priority: 75,
    };
  }
}
