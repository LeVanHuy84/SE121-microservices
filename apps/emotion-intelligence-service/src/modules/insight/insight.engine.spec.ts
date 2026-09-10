import { InsightEngine } from './insight.engine';
import { InsightRule, InsightContext, Insight } from './insight.types';
import { InsightTone, InsightType, RiskLevel } from '@repo/dtos';

describe('InsightEngine', () => {
  let engine: InsightEngine;
  let mockRules: InsightRule[];

  beforeEach(() => {
    mockRules = [
      {
        type: InsightType.HIGH_RISK,
        evaluate: (ctx: InsightContext): Insight | null => {
          if (ctx.riskState.riskLevel === RiskLevel.HIGH_RISK) {
            return {
              type: InsightType.HIGH_RISK,
              message: 'High risk detected',
              tone: InsightTone.CRITICAL,
              priority: 100,
            };
          }
          return null;
        },
      },
      {
        type: InsightType.DETERIORATING_TREND,
        evaluate: (ctx: InsightContext): Insight | null => {
          if (ctx.profile.decayedNegativityScore > 0.6) {
            return {
              type: InsightType.DETERIORATING_TREND,
              message: 'Negative trend detected',
              tone: InsightTone.CONCERNED,
              priority: 80,
            };
          }
          return null;
        },
      },
    ];

    engine = new InsightEngine(mockRules);
  });

  it('should return matched insights sorted by priority', () => {
    const mockContext: InsightContext = {
      profile: {
        decayedNegativityScore: 0.7,
        consecutiveNegativeDays: 3,
        emotionMomentum: -0.5,
      },
      riskState: {
        riskLevel: RiskLevel.HIGH_RISK,
        riskScore: 0.8,
        previousRiskScore: 0.5,
      },
      snapshot1d: {
        emotionVolatility: 0.3,
        negativeRatio: 0.7,
        baselineNegativeRatio: 0.2,
        trend: -0.3,
      },
    };

    const results = engine.generate(mockContext);

    expect(results.length).toBe(2);
    expect(results[0].type).toBe(InsightType.HIGH_RISK);
    expect(results[0].priority).toBe(100);
    expect(results[1].type).toBe(InsightType.DETERIORATING_TREND);
    expect(results[1].priority).toBe(80);
  });

  it('should return DEFAULT_STABLE_INSIGHT when no rules match', () => {
    const mockContext: InsightContext = {
      profile: {
        decayedNegativityScore: 0.1,
        consecutiveNegativeDays: 0,
        emotionMomentum: 0.1,
      },
      riskState: {
        riskLevel: RiskLevel.NORMAL,
        riskScore: 0.1,
        previousRiskScore: 0.1,
      },
      snapshot1d: {
        emotionVolatility: 0.1,
        negativeRatio: 0.1,
        baselineNegativeRatio: 0.1,
        trend: 0,
      },
    };

    const results = engine.generate(mockContext);

    expect(results.length).toBe(1);
    expect(results[0].type).toBe(InsightType.STABLE_STATE);
  });
});
