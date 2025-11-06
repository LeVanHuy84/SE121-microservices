export function calculateRankingScore(
  eventType: 'post' | 'share' | 'comment',
): number {
  const now = Date.now();

  const weights: Record<string, number> = {
    post: 1000,
    share: 500,
    comment: 300,
  };

  return now + (weights[eventType] ?? 0);
}
