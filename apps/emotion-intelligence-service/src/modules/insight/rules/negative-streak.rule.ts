import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class NegativeStreakRule implements InsightRule {
  readonly type = InsightType.NEGATIVE_STREAK;

  evaluate(context: InsightContext): Insight | null {
    if (context.profile.negativeEventStreak < 3) {
      return null;
    }

    return {
      type: this.type,
      message: 'Bạn đang có chuỗi cảm xúc tiêu cực kéo dài',
      tone: InsightTone.WARNING,
      priority: 90,
    };
  }
}
