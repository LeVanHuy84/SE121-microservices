import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_STABLE_INSIGHT,
  INSIGHT_RULES,
  Insight,
  InsightContext,
  InsightRule,
} from './insight.types';

const MAX_INSIGHTS = 5;

@Injectable()
export class InsightEngine {
  constructor(
    @Inject(INSIGHT_RULES)
    private readonly rules: InsightRule[],
  ) {}

  generate(context: InsightContext): Insight[] {
    const matchedInsights = this.rules
      .map((rule) => rule.evaluate(context))
      .filter((insight): insight is Insight => insight !== null)
      .sort((a, b) => b.priority - a.priority);

    const deduplicatedByType = new Map<string, Insight>();

    for (const insight of matchedInsights) {
      if (!deduplicatedByType.has(insight.type)) {
        deduplicatedByType.set(insight.type, insight);
      }
    }

    const topInsights = Array.from(deduplicatedByType.values()).slice(
      0,
      MAX_INSIGHTS,
    );

    return topInsights.length > 0 ? topInsights : [DEFAULT_STABLE_INSIGHT];
  }
}
