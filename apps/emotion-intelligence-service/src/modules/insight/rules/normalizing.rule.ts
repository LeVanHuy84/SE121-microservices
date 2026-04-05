import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class NormalizingRule implements InsightRule {
  readonly type = InsightType.NORMALIZING;

  evaluate(context: InsightContext): Insight | null {
    const { negativeRatio, baselineNegativeRatio, trend } = context.snapshot1d;

    if (
      negativeRatio === undefined ||
      baselineNegativeRatio === undefined ||
      trend === undefined ||
      !(negativeRatio > baselineNegativeRatio && trend < 0)
    ) {
      return null;
    }

    return {
      type: this.type,
      message: 'Cảm xúc của bạn đang dần trở về mức bình thường',
      tone: InsightTone.POSITIVE,
      priority: 55,
    };
  }
}
