import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class HighVolatilityRule implements InsightRule {
  readonly type = InsightType.HIGH_VOLATILITY;

  evaluate(context: InsightContext): Insight | null {
    if (context.snapshot1d.emotionVolatility <= 0.5) {
      return null;
    }

    return {
      type: this.type,
      message: 'Cảm xúc của bạn đang biến động mạnh',
      tone: InsightTone.WARNING,
      priority: 70,
    };
  }
}
