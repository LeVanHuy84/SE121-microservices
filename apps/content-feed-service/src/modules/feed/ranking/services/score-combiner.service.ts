import { Injectable } from "@nestjs/common";

@Injectable()
export class ScoreCombinerService {
  combine(input: {
    base: number;
    emotion: number;
    affinity: number;
    riskScore?: number;
    recentNegativityScore?: number;
  }): number {
    const normalizeBaseScore = this.normalize(input.base);

    const distress =
      (input.riskScore ?? 0) * 0.4 + (input.recentNegativityScore ?? 0) * 0.6;

    const emotionWeight = 0.3 + distress * 0.3;

    const affinityWeight = 0.15;

    const baseWeight = 1 - emotionWeight - affinityWeight;

    return (
      baseWeight * normalizeBaseScore +
      emotionWeight * input.emotion +
      affinityWeight * input.affinity
    );
  }

  private normalize(score: number): number {
    return 1 / (1 + Math.exp(-(score - 200) / 50));
  }
}
