import { Injectable } from '@nestjs/common';
import { Insight, InsightContext, InsightRule } from '../insight.types';
import { InsightTone, InsightType } from '@repo/dtos';

@Injectable()
export class StableStateRule implements InsightRule {
  readonly type = InsightType.STABLE_STATE;

  evaluate(context: InsightContext): Insight | null {
    const { emotionMomentum } = context.profile;
    const negativityScore =
      context.profile.recentNegativityScore ??
      context.profile.decayedNegativityScore ??
      0;
    const isStableMomentum = Math.abs(emotionMomentum) < 0.05;
    const inModerateNegativityBand =
      negativityScore >= 0.3 && negativityScore <= 0.6;

    if (!(isStableMomentum && inModerateNegativityBand)) {
      return null;
    }

    return {
      type: this.type,
      message: 'Cảm xúc của bạn hiện đang ổn định',
      tone: InsightTone.NEUTRAL,
      priority: 30,
    };
  }
}
