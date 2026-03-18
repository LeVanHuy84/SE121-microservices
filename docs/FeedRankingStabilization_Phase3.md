# Feed Ranking Stabilization Phase 3

## Files Modified

- apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts

## Old Ranking Formula

Trending final score was derived only from model-driven components:

- finalScore = trendingScore _ emotionalRelevance _ emotionalStateAdjustment _ riskMultiplier _ modalityWeight
- where trendingScore = (engagement^0.4) _ (freshness^0.2) _ (emotionBoost^0.3) \* (quality^0.1)

This ignored candidate baseScore from retrieval.

## New Ranking Formula

Trending now blends retrieval base score with model score:

- modelScore = trendingScore _ emotionalRelevance _ emotionalStateAdjustment _ riskMultiplier _ modalityWeight
- finalScore = baseScore^alpha \* modelScore^(1 - alpha)
- alpha = 0.7

Implementation details:

- baseScore and modelScore are normalized to positive finite values before exponentiation to avoid invalid math states.
- existing feature computations (engagement/freshness/emotion/quality/safety/risk/modality) were preserved.

## Why Reorder Distance Is Reduced

- baseScore now contributes 70 percent of ranking influence in log-space via the geometric blend.
- items with strong model signals can still move up, but cannot freely overpower retrieval order as before.
- this reduces extreme reshuffles across requests, mitigates starvation risk for high-base candidates, and improves ranking stability without changing pagination or cursor behavior.
