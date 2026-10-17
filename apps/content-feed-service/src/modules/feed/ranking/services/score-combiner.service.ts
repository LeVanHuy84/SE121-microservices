import { Injectable } from "@nestjs/common";

@Injectable()
export class ScoreCombinerService {
  private readonly SCORE_MIN = 0.5;
  private readonly SCORE_MAX = 15.0; // Tương đương ~3 triệu tương tác

  combine(input: {
    base: number;
    emotion: number;
    affinity: number;
    riskScore?: number;
    recentNegativityScore?: number;
  }): number {
    const normalizedBase = this.normalizeBaseScore(input.base);

    const distress = Math.min(
      1,
      Math.max(
        0,
        (input.riskScore ?? 0) * 0.4 + (input.recentNegativityScore ?? 0) * 0.6,
      ),
    );

    // Trọng số biến thiên thích ứng
    const emotionWeight = 0.25 + distress * 0.35; // Dao động 0.25 -> 0.60
    const affinityWeight = 0.15 * (1 - distress * 0.5); // Giảm bớt ưu tiên sở thích cá nhân khi đang bất ổn
    const baseWeight = Math.max(0.1, 1 - emotionWeight - affinityWeight);

    return (
      baseWeight * normalizedBase +
      emotionWeight * input.emotion +
      affinityWeight * input.affinity
    );
  }

  normalizeBaseScore(score: number): number {
    if (!score || score <= this.SCORE_MIN) return 0;
    const logVal = Math.log1p(score);
    const logMin = Math.log1p(this.SCORE_MIN);
    const logMax = Math.log1p(this.SCORE_MAX);
    return Math.min(1, Math.max(0, (logVal - logMin) / (logMax - logMin)));
  }
}
