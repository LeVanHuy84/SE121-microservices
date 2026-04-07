import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class HighNegativityRule implements InsightRule {
  readonly type = InsightType.HIGH_NEGATIVITY;

  evaluate(context: InsightContext): Insight | null {
    if (context.profile.recentNegativityScore <= 0.6) {
      return null;
    }

    return {
      type: this.type,
      message: 'Mức độ tiêu cực gần đây của bạn khá cao',
      tone: InsightTone.WARNING,
      priority: 80,
    };
  }
}
