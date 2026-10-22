import { EmotionRankingFeaturesDto, PersonalFeedQuery } from "@repo/dtos";

export class PersonalFeedHelper {
  private static readonly TAU = 1000 * 60 * 60 * 12; // 12h

  static getRankingCacheKey(userId: string, query: PersonalFeedQuery) {
    return `feed:ranking:${userId}:${query.mainEmotion?.toLowerCase() || "all"}`;
  }

  // ==========================================
  // 🎟️ SESSION SNAPSHOT CURSOR ENCODING
  // ==========================================
  static encodeSessionCursor(sessionId: string, offset: number): string {
    const payload = JSON.stringify({ s: sessionId, o: offset, t: Date.now() });
    return Buffer.from(payload, "utf-8").toString("base64url");
  }

  static decodeSessionCursor(
    cursor?: string,
  ): { sessionId: string; offset: number } | null {
    if (!cursor) return null;

    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
      const parsed = JSON.parse(decoded);

      if (typeof parsed.s === "string" && typeof parsed.o === "number") {
        return {
          sessionId: parsed.s,
          offset: Math.max(0, parsed.o),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ==========================================
  // ⌛ LEGACY CURSOR (BACKWARD COMPATIBILITY)
  // ==========================================
  static encodeCursor(score: number, itemId: string) {
    return Buffer.from(`${score}|${itemId}`).toString("base64");
  }

  static decodeCursor(cursor?: string) {
    if (!cursor) return null;

    try {
      const [score, itemId] = Buffer.from(cursor, "base64")
        .toString()
        .split("|");

      return {
        score: Number(score),
        itemId,
      };
    } catch {
      return null;
    }
  }

  // ==========================================
  // 📊 COMPONENT SIGNALS
  // ==========================================
  static calcRecency(createdAt?: Date): number {
    if (!createdAt) return 0;

    const age = Date.now() - new Date(createdAt).getTime();
    return Math.exp(-age / this.TAU);
  }

  static calcEngagement(stats: any): number {
    const raw =
      (stats?.reactions || 0) +
      (stats?.comments || 0) * 2 +
      (stats?.shares || 0) * 3;

    return Math.min(1, Math.log1p(raw) / 10);
  }

  // ==========================================
  // 🧠 5-PARAMETER EMA DISTRESS FORMULATION
  // ==========================================
  static calcDistress(
    features?: Partial<EmotionRankingFeaturesDto> | null,
  ): number {
    if (!features) return 0;

    const risk = Number(features.riskScore) || 0;
    const recentNeg = Number(features.recentNegativityScore) || 0;
    const negRatio7d = Number(features.negativeRatio7d) || 0;
    const volatility = Number(features.emotionVolatility7d) || 0;
    const momentum = Number(features.emotionMomentum) || 0;

    const raw =
      0.3 * risk +
      0.35 * recentNeg +
      0.15 * negRatio7d +
      0.2 * volatility -
      0.1 * momentum;

    return Math.max(0, Math.min(1, raw));
  }

  // ==========================================
  // 🎯 DYNAMIC ADAPTIVE MULTI-OBJECTIVE RANKING
  // ==========================================
  static calcAdaptiveScore(input: {
    recency: number;
    affinity: number;
    emotion: number;
    engagement: number;
    distress: number;
    toxicity?: number;
  }): number {
    const d = Math.max(0, Math.min(1, input.distress));

    const wRec = 0.4 * (1 - 0.75 * d);
    const wAff = 0.2 * (1 - 0.5 * d);
    const wEmo = 0.35 + 0.45 * d;
    const wEng = 0.05 * (1 - 0.6 * d);
    const lambda = 0.3 + 0.7 * d;

    const sum = wRec + wAff + wEmo + wEng;
    const base =
      sum > 0
        ? (wRec * input.recency +
            wAff * input.affinity +
            wEmo * input.emotion +
            wEng * input.engagement) /
          sum
        : 0;

    const penalty = lambda * (input.toxicity ?? 0);
    return Math.max(0, Math.min(1, base - penalty));
  }

  static calcFinalScore(input: {
    recency: number;
    emotion: number;
    affinity: number;
    engagement: number;
  }): number {
    return this.calcAdaptiveScore({
      ...input,
      distress: 0,
    });
  }
}
