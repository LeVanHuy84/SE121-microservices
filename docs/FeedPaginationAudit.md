# Feed Pagination & Ranking Audit

## Overview

The feed pipeline has two retrieval paths:

- Personal feed: MongoDB retrieval from `feed_items` ordered by `rankingScore DESC, createdAt DESC`, then re-ranked by `RankingService.rankForPersonal`.
- Trending feed: Redis ZSET retrieval by score (`ZREVRANGEBYSCORE`), then re-ranked by `RankingService.rankForTrending`.

Both paths implement over-fetch (`limit * 3`) and then return top `limit` after re-ranking. This architecture is vulnerable when cursor progression is not aligned with the ranking order used to choose returned items.

## Identified Issues

### Issue 1 — Cursor Mismatch

Problem:

- Retrieval ordering and pagination boundary are based on base retrieval score (`rankingScore` in Mongo, ZSET score in Redis).
- Returned order is based on `finalScore` from ranking strategies.
- Cursor is derived from an item selected by re-ranked order, but interpreted by base retrieval order.

Evidence:

- Personal retrieval sort and cursor predicate: `rankingScore, createdAt` in `getFeedItems`.
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:273`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:276`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:285`
- Personal re-ranking and top-K selection:
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:91`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:96`
- Personal cursor generated from `lastRanked` mapping to `lastFeedItem.rankingScore`:
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:195`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:200`
- Trending retrieval by ZSET base score and re-ranking:
  - `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:84`
  - `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:131`
  - `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:137`
- Trending cursor generated from `last.baseScore` of re-ranked page:
  - `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:183`

Impact:

- Page boundary does not represent the true frontier of returned candidates under base ordering.
- Leads to duplicated items or skipped unseen items when moving to next page.

Severity: High

### Issue 2 — Duplicate Post Risk

Problem:

- Re-ranking pagination can produce duplicate/skip behavior because cursor frontier is based on last re-ranked item, not last retrieved candidate in base order.

Reproduction pattern (present in both personal and trending):

1. Retrieve top `limit * 3` by base score.
2. Re-rank and return top `limit`.
3. Build cursor from last returned item.
4. Next query filters by base score using that cursor.

Why duplication/skip happens:

- If returned top-K contains a low base-score item promoted by re-ranking, cursor may move too far down and skip unseen higher base-score items from current candidate window.
- If cursor is too high relative to some already-returned promoted items, those items can reappear on the next page.

Evidence:

- Personal over-fetch and top-K:
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:52`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:57`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:96`
- Trending over-fetch and top-K:
  - `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:83`
  - `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:137`

Impact:

- Duplicate posts across pages.
- Missing posts that are never returned.
- User sees unstable infinite-scroll behavior.

Severity: Critical

### Issue 3 — Candidate Window Bias

Problem:

- Candidate window is hard-capped at `limit * 3` in both personal and trending services.
- Only this narrow slice is considered for ranking each request.

Evidence:

- Personal: `overFetchLimit = limit * 3`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:52`
- Trending: `candidateLimit = limit * 3`
  - `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:83`

Bias effects:

- Items outside the first window cannot compete for current page even if re-ranker would prefer them.
- Combined with cursor mismatch, items can be starved indefinitely.
- Trending re-ranker ignores base score entirely, increasing reorder distance and amplifying starvation.
  - `apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts:44`
  - `apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts:83`

Severity: High

### Issue 4 — Non-deterministic Cursor

Problem A (Trending):

- Cursor stores `score_createdAt`, but parser reads only score and ignores createdAt.
  - Write: `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:183`
  - Parse: `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:75`
- This means no secondary tie-break for equal scores.
- Query uses score-only exclusive bound (`(score`) in Redis.
  - `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts:77`

Problem B (Personal):

- Personal cursor includes score + createdAt and uses correct predicate shape.
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:276`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:278`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:279`
- But sorting uses only `rankingScore, createdAt` without a final unique tie-break key (for exact ties).
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:285`

Additional instability:

- Ranking uses time-decay with `Date.now()` and timestamp-based freshness each request, so scores naturally drift between requests.
  - Personal freshness: `apps/feed-service/src/modules/ranking/strategies/personal-ranking.strategy.ts:213`
  - Trending freshness: `apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts:111`

Severity: High (Trending), Medium (Personal)

### Issue 5 — Identity Collision

Problem:

- Personal ranking identity is `postId`, but feed event identity is actually (`eventType`, `refId`) and feed item `_id`.
- Multiple feed items can share the same `postId` (e.g., post + share, multiple shares, repeated distribution).

Evidence:

- Candidate build includes one candidate per feed item but with only `postId` identity:
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:77`
- After ranking, selected IDs are converted to a `Set(postId)` (dedup at post level):
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:100`
- Then all candidate feed items with that postId are kept:
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:101`
- Final mapping for each ranked item uses first `find` by `postId` only:
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:164`
  - `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts:165`

Why this is risky:

- Two ranked entries with same `postId` can map to the same first feed item repeatedly -> duplicate DTO rows.
- SHARE and POST for same `postId` can be collapsed/mis-mapped.
- Cursor may be generated from the wrong feed item among collisions.

Structural contributor:

- Feed schema has indexes but no unique key preventing multiple same-post rows per user/event/ref.
  - `apps/feed-service/src/mongo/schema/feed-item.schema.ts:9`
  - `apps/feed-service/src/mongo/schema/feed-item.schema.ts:20`
  - no unique index present in this schema.
- Distribution inserts in bulk with `insertMany` and no dedup/upsert guard.
  - `apps/feed-service/src/modules/ingestion/service/distribution.service.ts:76`

Severity: Critical

## Code Locations

Primary files audited:

- `apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts`
- `apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts`
- `apps/feed-service/src/modules/feed-pipeline/services/stats.trending.cron.ts`
- `apps/feed-service/src/modules/ranking/services/ranking.service.ts`
- `apps/feed-service/src/modules/ranking/strategies/personal-ranking.strategy.ts`
- `apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts`

Supporting files:

- `apps/feed-service/src/mongo/repository/snapshot.repository.ts`
- `apps/feed-service/src/mongo/schema/feed-item.schema.ts`
- `apps/feed-service/src/modules/ingestion/service/distribution.service.ts`
- `apps/feed-service/src/utils/utils.ts`

## Severity Assessment

- Issue 1 — Cursor Mismatch: High
- Issue 2 — Re-ranking Pagination Duplication/Skip: Critical
- Issue 3 — Candidate Window Bias: High
- Issue 4 — Non-deterministic Cursor: High (Trending), Medium (Personal)
- Issue 5 — Identity Collision: Critical

## Recommended Fixes

1. Use cursor from retrieval frontier, not re-ranked frontier.

- Keep retrieval cursor based on the last scanned candidate in base order, not the last returned ranked item.
- Return both:
  - UI order: re-ranked top-K.
  - Cursor frontier: base-order boundary from the scanned window.

2. Add stable tie-breakers.

- Personal: include `_id` in sort and cursor predicate.
  - Sort: `(rankingScore DESC, createdAt DESC, _id DESC)`.
  - Cursor condition: `(score < c.score) OR (score = c.score AND createdAt < c.ts) OR (score = c.score AND createdAt = c.ts AND _id < c.id)`.
- Trending: include member ID tie-break for equal ZSET scores, or use a composite sorted-set member strategy.

3. Fix trending cursor contract.

- If cursor encodes `score_createdAt`, parser must use both fields.
- Or simplify cursor to score-only and document equal-score behavior, but then implement deterministic tie-break handling.

4. Separate retrieval identity from ranking identity.

- Personal candidate key should be feed-item identity (`feedItemId` or `{eventType, refId}`), not only `postId`.
- Keep `postId` for content features, but map output by candidate identity.

5. Prevent identity collisions at storage layer.

- Add unique index (example): `(userId, eventType, refId)`.
- Use idempotent writes/upserts in distribution path instead of blind `insertMany`.

6. Reduce candidate starvation.

- Replace fixed `limit * 3` with adaptive windowing (`limit * factor`, where factor grows if rank deltas are large).
- Optionally use two-phase retrieval: pull multiple base segments until enough stable ranked items are selected.

7. Keep re-ranker anchored to retrieval score when required.

- Personal strategy already multiplies by `baseScore`.
  - `apps/feed-service/src/modules/ranking/strategies/personal-ranking.strategy.ts:157`
- Trending strategy currently ignores `baseScore`, which allows large reorder distance.
  - `apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts:83`
- Consider blending: `final = baseScore^alpha * modelScore^(1-alpha)` with tuned alpha.

## Suggested Refactor

Safer architecture for paginated re-ranking:

1. Retrieval phase

- Query by deterministic base order with full tie-break keys.
- Scan a window larger than `limit` and track exact scanned frontier.

2. Ranking phase

- Re-rank scanned candidates for presentation only.
- Optionally deduplicate by content identity at this stage with explicit policy.

3. Response phase

- Return top `limit` ranked items.
- Return cursor built from scanned frontier tuple (not returned-ranked last item).
- Return optional debug metadata: scannedCount, dedupedCount, frontier tuple.

4. Persistence guards

- Add feed item uniqueness constraints and idempotent ingestion.
- Add tests for page continuity:
  - no duplicates across pages
  - no skipped items under stable dataset
  - deterministic traversal under ties
