import { PersonalFeedQuery } from "@repo/dtos";

export class PersonalFeedHelper {
  private static readonly TAU = 1000 * 60 * 60 * 12; // 12h

  static getRankingCacheKey(userId: string, query: PersonalFeedQuery) {
    return `feed:ranking:${userId}:${query.mainEmotion?.toLowerCase() || "all"}`;
  }

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

  static calcFinalScore(input: {
    recency: number;
    emotion: number;
    affinity: number;
    engagement: number;
  }): number {
    return (
      0.4 * input.recency +
      0.2 * input.affinity +
      0.35 * input.emotion +
      0.05 * input.engagement
    );
  }
}
