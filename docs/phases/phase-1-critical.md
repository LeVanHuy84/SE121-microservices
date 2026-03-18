# PHASE 1: CRITICAL BUG FIXES

## OBJECTIVES

- Replace unstable multiplicative ranking path with deterministic linear scoring.
- Fix stale cache behavior in emotion features and local affinity cache.
- Add critical user-behavior signals (skip/dwell) to affinity updates.
- Add safe migration flags for high-risk ranking and affinity cutovers.

---

## TASKS LIST

### TASK P1-T01: LINEAR_RANKING_CORE

**TARGET FILE**

- apps/feed-service/src/modules/ranking/ranking.constants.ts
- apps/feed-service/src/modules/ranking/services/ranking.service.ts
- apps/feed-service/src/modules/ranking/strategies/personal-ranking.strategy.ts
- apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts

**PURPOSE**

- Replace multi-multiplier final score path with one weighted linear formula.

**INPUT**

- `RankingCandidate.snapshot.stats`
- `RankingCandidate.timestamp`
- `RankingContext.userAffinity`
- `RankingContext.emotionFeatures`
- `RankingContext.recentEmotions`

**OUTPUT**

- Stable `finalScore` in `[0, 1]`.
- `featureScores` breakdown with fixed keys.

**STEP**

1. Add ranking weights constant:
   - personal: `engagement=0.25, freshness=0.30, affinity=0.35, safety=0.10`
   - trending: `engagement=0.50, freshness=0.25, affinity=0.15, safety=0.10`
2. Add factor normalizers in `ranking.service.ts`:
   - `normalizeEngagement(stats): number`
   - `normalizeFreshness(timestamp): number`
   - `normalizeAffinity(emotionLabel, intensity, userAffinity): number`
   - `normalizeSafety(emotionLabel, emotionFeatures): number`
3. Implement linear score formula:
   - `scoreRaw = e*we + f*wf + a*wa + s*ws`
4. Apply diversity penalty after linear score:
   - `scoreFinal = scoreRaw * pow(0.95, sameEmotionCountInRecent)`
5. Keep sorting descending by `finalScore`.
6. Keep strategy classes as wrappers to shared scorer (do not fully delete strategies in this phase).

**CODE STRUCTURE**

- Add function: `computeLinearScore()`
- Add function: `computeFactorBreakdown()`
- Add function: `computeScoreWithMode()`
- Modify function: `rankForPersonal()`
- Modify function: `rankForTrending()`
- Modify function: `PersonalRankingStrategy.computeScore()` to wrap shared scorer
- Modify function: `TrendingRankingStrategy.computeScore()` to wrap shared scorer
- Remove: multiplicative final aggregation path from active flow

**LOGIC (REQUIRES Pseudocode)**

```ts
function computeLinearScore(candidate, context, weights): ScoreResult {
  e = normalizeEngagement(candidate.snapshot.stats);
  f = normalizeFreshness(candidate.timestamp);
  a = normalizeAffinity(
    candidate.snapshot.emotionFeature?.label,
    candidate.snapshot.emotionFeature?.intensity,
    context.userAffinity,
  );
  s = normalizeSafety(
    candidate.snapshot.emotionFeature?.label,
    context.emotionFeatures,
  );

  scoreRaw =
    e * weights.engagement +
    f * weights.freshness +
    a * weights.affinity +
    s * weights.safety;

  sameEmotionCount = count(
    context.recentEmotions == candidate.snapshot.emotionFeature?.label,
  );
  diversityPenalty = pow(0.95, sameEmotionCount);

  scoreFinal = clamp(scoreRaw * diversityPenalty, 0, 1);

  return {
    finalScore: scoreFinal,
    featureScores: {
      engagement: e,
      freshness: f,
      affinity: a,
      safety: s,
      diversityPenalty,
    },
  };
}
```

**DEPENDENCES**

- None.

**TESTING CASES**

- Case 1: High engagement, old post -> score moderate due to freshness penalty.
- Case 2: Low engagement, fresh post, high affinity -> score moderate-high in personal.
- Case 3: Same emotion repeated 10 times in recent list -> diversity penalty < 0.7.
- Exception: Missing `emotionFeature` -> use neutral defaults, no crash.

---

### TASK P1-T02: SAFETY_SCORE_BOUNDARY

**TARGET FILE**

- apps/feed-service/src/modules/ranking/services/ranking.service.ts
- apps/feed-service/src/modules/ranking/interfaces/emotion-categories.interface.ts

**PURPOSE**

- Make emotional safety influence bounded and deterministic.

**INPUT**

- `emotionFeatures.riskScore`
- `emotionFeatures.negativeStreak`
- post emotion label

**OUTPUT**

- Safety factor normalized to `[0, 1]`.

**STEP**

1. Add a single safety mapping function in `ranking.service.ts`.
2. Apply rules in this exact order:
   1. If `riskScore > 0.7` and post positive -> multiplier `2.5`.
   2. If `riskScore > 0.7` and post negative -> multiplier `0.3`.
   3. Else if `negativeStreak > 3` and post positive -> `1 + min(negativeStreak/10, 0.5)`.
   4. Else -> `1.0`.
3. Normalize with `normalized = clamp(multiplier / 2.5, 0, 1)`.
4. Use this output in `computeLinearScore` only.

**CODE STRUCTURE**

- Add function: `computeSafetyFactor()`
- Remove: duplicated safety factor calculations from strategy classes

**LOGIC (REQUIRES Pseudocode)**

```ts
function computeSafetyFactor(label, features): number {
  if (!label) return 0.4;

  multiplier = 1.0;

  if (features?.riskScore > 0.7) {
    if (isPositiveEmotion(label)) multiplier = 2.5;
    else if (isNegativeEmotion(label)) multiplier = 0.3;
  } else if ((features?.negativeStreak ?? 0) > 3 && isPositiveEmotion(label)) {
    multiplier = 1 + min(features.negativeStreak / 10, 0.5);
  }

  return clamp(multiplier / 2.5, 0, 1);
}
```

**DEPENDENCES**

- Must run after `P1-T01` helper extraction OR in same commit.

**TESTING CASES**

- Input: `riskScore=0.8`, positive post -> safety near `1.0`.
- Input: `riskScore=0.8`, negative post -> safety near `0.12`.
- Input: `negativeStreak=6`, positive post -> safety > baseline.
- Exception: `emotionFeatures=null` -> baseline safety only.

---

### TASK P1-T03: EMOTION_CACHE_TTL_FIX

**TARGET FILE**

- apps/feed-service/src/modules/ranking/services/emotion-feature.service.ts

**PURPOSE**

- Reduce stale emotional-state lag by lowering feature cache TTL.

**INPUT**

- Cached user emotion features in Redis.
- Analysis service response.

**OUTPUT**

- Cache TTL set to 15 minutes.
- Resilient fallback to last cached valid data when remote fetch fails.

**STEP**

1. Change `CACHE_TTL_SECONDS` from `3600` to `900`.
2. Add fallback path:
   - If fetch fails, return already cached value (if exists).
   - Do not overwrite cache with `null`.
3. Add warning log once per request path when fallback used.

**CODE STRUCTURE**

- Modify constant: `CACHE_TTL_SECONDS`
- Add function: `getCachedFeaturesRaw()` (optional helper)
- Modify function: `getEmotionFeatures()`
- Keep function: `normalizeFeatures()`

**LOGIC (REQUIRES Pseudocode)**

```ts
async function getEmotionFeatures(userId) {
  cached = await getCachedFeatures(userId);
  if (cached) return cached;

  fetched = await fetchFromAnalysisService(userId);
  if (fetched) {
    normalized = normalizeFeatures(fetched);
    await cacheFeatures(userId, normalized, 900);
    return normalized;
  }

  fallback = await getCachedFeatures(userId);
  if (fallback) {
    logWarn('emotion-feature fallback');
    return fallback;
  }

  return null;
}
```

**DEPENDENCES**

- None.

**TESTING CASES**

- Input: cached exists, API down -> return cached.
- Input: no cache, API ok -> return normalized + cache set to 900.
- Input: no cache, API down -> return null.
- Exception: corrupted cache JSON -> recover without throw.

---

### TASK P1-T04: SKIP_DWELL_AFFINITY_SIGNAL

**TARGET FILE**

- apps/feed-service/src/modules/affinity/affinity.constants.ts
- apps/feed-service/src/modules/affinity/user-affinity.service.ts

**PURPOSE**

- Add critical user-behavior signal path for skip and dwell duration.

**INPUT**

- `userId`
- `emotionLabel`
- `viewMs`
- `isSkip`

**OUTPUT**

- Affinity update path supports negative and positive view feedback.

**STEP**

1. Extend interaction weight map:
   - `skip = -0.35`
   - `view_short = -0.15`
   - `view_long = +0.10`
2. Add function `resolveViewSignalWeight(viewMs, isSkip)`.
3. Add function `updateAffinityFromView(userId, emotionLabel, viewMs, isSkip)`.
4. Decision rules:
   - If `isSkip=true` -> `skip`
   - Else if `viewMs < 2000` -> `view_short`
   - Else if `viewMs >= 5000` -> `view_long`
   - Else -> no update
5. Route signed weight into existing affinity update path and clamp `[0, 1]`.

**CODE STRUCTURE**

- Add function: `resolveViewSignalWeight()`
- Add function: `updateAffinityFromView()`
- Modify constant: `INTERACTION_WEIGHTS`
- Modify function: `updateAffinity()` to accept signed weight

**LOGIC (REQUIRES Pseudocode)**

```ts
function resolveViewSignalWeight(viewMs, isSkip): number {
  if (isSkip) return -0.35;
  if (viewMs < 2000) return -0.15;
  if (viewMs >= 5000) return 0.1;
  return 0;
}

async function updateAffinityFromView(userId, emotionLabel, viewMs, isSkip) {
  w = resolveViewSignalWeight(viewMs, isSkip);
  if (w === 0) return;
  await updateAffinity(userId, emotionLabel, mapWeightToAction(w));
}
```

**DEPENDENCES**

- None.

**TESTING CASES**

- Input: `isSkip=true` on sadness -> sadness affinity decreases.
- Input: `viewMs=7000` on joy -> joy affinity increases slightly.
- Input: `viewMs=3000` -> no update.
- Exception: empty emotion label -> no-op.

---

### TASK P1-T05: LOCAL_AFFINITY_CACHE_TTL

**TARGET FILE**

- apps/feed-service/src/modules/affinity/user-affinity.service.ts

**PURPOSE**

- Prevent stale local-memory affinity reads.

**INPUT**

- Existing `localAffinityCache` map entries.
- Redis affinity source of truth.

**OUTPUT**

- Local cache entries expire in 5 minutes.
- Stale entries are evicted/read-through from Redis.

**STEP**

1. Replace plain map value with `{ data, expiry }`.
2. Set `LOCAL_CACHE_TTL_MS = 300000`.
3. In `getUserAffinity`:
   - return local value only when `now < expiry`
   - otherwise fetch Redis, refresh local cache
4. On `updateAffinity` and `updateAffinityFromView`, refresh local cache with new expiry.

**CODE STRUCTURE**

- Modify field: `localAffinityCache`
- Add function: `isLocalCacheValid()`
- Modify function: `getUserAffinity()`
- Modify function: `setLocalAffinityCache()`

**LOGIC (REQUIRES Pseudocode)**

```ts
function isLocalCacheValid(entry): boolean {
  return !!entry && Date.now() < entry.expiry;
}

async function getUserAffinity(userId) {
  entry = localAffinityCache.get(userId);
  if (isLocalCacheValid(entry)) return entry.data;

  fresh = await readAffinityFromRedis(userId);
  setLocalAffinityCache(userId, fresh, Date.now() + 300000);
  return fresh;
}
```

**DEPENDENCES**

- None.

**TESTING CASES**

- Input: cached and not expired -> no Redis read.
- Input: expired cache -> Redis read occurs.
- Input: cache missing -> Redis read and set.
- Exception: Redis read failure -> fallback default affinity.

---

### TASK P1-T06: MIGRATION_FLAGS_AND_DUAL_RUN

**TARGET FILE**

- apps/feed-service/src/modules/ranking/ranking.constants.ts
- apps/feed-service/src/modules/affinity/affinity.constants.ts
- apps/feed-service/src/modules/ranking/services/ranking.service.ts
- apps/feed-service/src/modules/affinity/user-affinity.service.ts

**PURPOSE**

- Add safe rollout switches for critical ranking and affinity changes.

**INPUT**

- Environment variables.
- Old score outputs and new score outputs.

**OUTPUT**

- `USE_LINEAR_RANKING` and `USE_WINDOW_AFFINITY` flags.
- Dual-run compare logs for cutover safety.

**STEP**

1. Define env flags in constants:
   - `USE_LINEAR_RANKING`
   - `USE_WINDOW_AFFINITY`
2. Add dual-run mode:
   - compute old + new scores in parallel when debug flag on
   - log top-N divergence for verification
3. Set active path by flag without deleting fallback path.
4. Keep old path for one migration cycle, then remove in later phase.

**CODE STRUCTURE**

- Add function: `resolveRankingMode()`
- Add function: `resolveAffinityMode()`
- Add function: `logScoreDivergence()`
- Modify function: `rankForPersonal()`
- Modify function: `rankForTrending()`
- Modify function: `getUserAffinity()`

**LOGIC (REQUIRES Pseudocode)**

```ts
function resolveRankingMode(env): 'legacy' | 'linear' {
  return env.USE_LINEAR_RANKING === 'true' ? 'linear' : 'legacy';
}

async function rankForPersonal(candidates, userId) {
  mode = resolveRankingMode(process.env);
  if (mode === 'linear') return rankLinear(candidates, userId);
  return rankLegacy(candidates, userId);
}

async function maybeLogDivergence(candidates, userId) {
  if (process.env.DEBUG_DUAL_RUN !== 'true') return;
  oldRank = await rankLegacy(candidates, userId);
  newRank = await rankLinear(candidates, userId);
  logScoreDivergence(oldRank, newRank);
}
```

**DEPENDENCES**

- None.

**TESTING CASES**

- Input: `USE_LINEAR_RANKING=true` -> linear path active.
- Input: `USE_LINEAR_RANKING=false` -> legacy path active.
- Input: `DEBUG_DUAL_RUN=true` -> divergence logs emitted.
- Exception: missing env values -> defaults to legacy-safe behavior.

---

## TASK EXECUTION ORDER

1. P1-T01
2. P1-T02
3. P1-T03
4. P1-T04
5. P1-T05
6. P1-T06

Dependency rules:

- P1-T02 depends on factor extraction from P1-T01.
- P1-T04 and P1-T05 can run in parallel after affinity touchpoints are identified.
- P1-T06 should run after P1-T01 and P1-T05 so migration toggles cover finalized paths.
- No circular dependencies.

---

## CONSTRAINTS

- Do not introduce Kafka, stream processors, or ML pipelines.
- Use only simple formulas, existing NestJS services, Redis, and cron-ready logic.

---

## DESIGN PRINCIPLES

- Keep functions pure and small.
- Keep each score factor independently testable.
- Keep logs structured for debugging.
