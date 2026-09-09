import { HighRiskRule } from './high-risk.rule';
import { InsightContext } from '../insight.types';
import { InsightTone, InsightType, RiskLevel } from '@repo/dtos';

describe('HighRiskRule', () => {
  let rule: HighRiskRule;

  beforeEach(() => {
    rule = new HighRiskRule();
  });

  it('should return insight when riskLevel is HIGH_RISK or CRISIS', () => {
    const contextHigh: InsightContext = {
      profile: {
        decayedNegativityScore: 0.8,
        consecutiveNegativeDays: 4,
        emotionMomentum: -0.6,
      },
      riskState: {
        riskLevel: RiskLevel.HIGH_RISK,
        riskScore: 0.85,
        previousRiskScore: 0.6,
      },
      snapshot1d: {
        emotionVolatility: 0.4,
        negativeRatio: 0.8,
        baselineNegativeRatio: 0.2,
        trend: -0.4,
      },
    };

    const resultHigh = rule.evaluate(contextHigh);
    expect(resultHigh).not.toBeNull();
    expect(resultHigh?.type).toBe(InsightType.HIGH_RISK);
    expect(resultHigh?.tone).toBe(InsightTone.CRITICAL);
    expect(resultHigh?.priority).toBe(100);
  });

  it('should return null when riskLevel is STABLE or NORMAL', () => {
    const contextNormal: InsightContext = {
      profile: {
        decayedNegativityScore: 0.1,
        consecutiveNegativeDays: 0,
        emotionMomentum: 0,
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

    const resultNormal = rule.evaluate(contextNormal);
    expect(resultNormal).toBeNull();
  });
});

