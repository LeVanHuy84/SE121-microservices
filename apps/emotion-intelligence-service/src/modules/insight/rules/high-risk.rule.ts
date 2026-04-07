import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class HighRiskRule implements InsightRule {
  readonly type = InsightType.HIGH_RISK;

  evaluate(context: InsightContext): Insight | null {
    if (context.riskState.riskLevel !== 'high') {
      return null;
    }

    return {
      type: this.type,
      message: 'Bạn đang ở mức rủi ro cao',
      tone: InsightTone.CRITICAL,
      priority: 100,
    };
  }
}
