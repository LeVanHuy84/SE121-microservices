import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class AboveBaselineRule implements InsightRule {
  readonly type = InsightType.ABOVE_BASELINE;

  evaluate(context: InsightContext): Insight | null {
    const { negativeRatio, baselineNegativeRatio } = context.snapshot1d;

    if (
      negativeRatio === undefined ||
      baselineNegativeRatio === undefined ||
      negativeRatio <= baselineNegativeRatio + 0.05
    ) {
      return null;
    }

    return {
      type: this.type,
      message: 'Mức tiêu cực hiện tại cao hơn bình thường của bạn',
      tone: InsightTone.WARNING,
      priority: 65,
    };
  }
}
