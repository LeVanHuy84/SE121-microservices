# PHASE 2: CRITICAL IMPROVEMENTS

## OBJECTIVES

- Replace EMA-only affinity logic with simple recency windows that are maintainable for 2 developers.
- Define explicit view/skip input contract for deterministic affinity updates.
- Improve trending relevance using corrected velocity and a lightweight quality term.

---

## TASKS LIST

### TASK P2-T01: WINDOW_BASED_AFFINITY_SIMPLIFIED

**TARGET FILE**

- apps/feed-service/src/modules/affinity/user-affinity.service.ts
- apps/feed-service/src/modules/affinity/affinity.constants.ts

**PURPOSE**

- Replace EMA-only affinity updates with explainable 7d/30d scoring while avoiding complex Redis structures.

**INPUT**

- User interaction events with emotion labels, intensity, timestamp.
- Existing interaction weights from constants.

**OUTPUT**

- Emotion affinity score with natural recency decay.

**STEP**

1. Add window constants:
   - `WINDOW_7D_WEIGHT = 1.0`
   - `WINDOW_30D_WEIGHT = 0.7`
   - `INTENSITY_WEIGHT = 0.5`
2. Store compact per-emotion daily aggregates (not per-event bucket chains):
   - `agg:{userId}:{emotion}:{yyyy-mm-dd}` -> `{count, sumIntensity, sumWeightedEngagement}`
3. Add one daily cron cleanup:
   - remove aggregates older than 30 days.
4. Compute affinity from last 30 days using two ranges:
   - recent (0-7d)
   - older (8-30d)
5. Compute formula:
   - `recent = count7d*1.0 + avgIntensity7d*0.5 + weightedEngagement7d*0.3`
   - `older = count30d*0.7 + avgIntensity30d*0.35 + weightedEngagement30d*0.21`
   - `score = (recent + older*0.5) / (count7d + count30d*0.7 + 1)`
6. Clamp each score to `[0, 1]` and fallback to default affinity for empty data.

**CODE STRUCTURE**

- Add function: `updateDailyAffinityAggregate()`
- Add function: `getWindowAggregates()`
- Add function: `computeAffinityFromWindows()`
- Modify function: `updateAffinity()`
- Modify function: `getUserAffinity()`
- Add cron function: `cleanupOldAffinityAggregates()`

**LOGIC (REQUIRES Pseudocode)**

```ts
function computeAffinityFromWindows(windowData): number {
  avgIntensity7d = safeDiv(windowData.sumIntensity7d, windowData.count7d)
  avgIntensity30d = safeDiv(windowData.sumIntensity30d, windowData.count30d)

  recent =
    windowData.count7d * 1.0 +
    avgIntensity7d * 0.5 +
    windowData.sumWeightedEngagement7d * 0.3

  older =
    windowData.count30d * 0.7 +
    avgIntensity30d * 0.35 +
    windowData.sumWeightedEngagement30d * 0.21

  denominator = windowData.count7d + windowData.count30d * 0.7 + 1
  return clamp((recent + older * 0.5) / denominator, 0, 1)
}
```

**DEPENDENCES**

- Requires Phase 1 migration flags available (`USE_WINDOW_AFFINITY`).

**TESTING CASES**

- Input: many interactions in 7d -> affinity rises quickly.
- Input: only old interactions (30d) -> affinity decays.
- Input: zero interactions -> fallback default affinity.
- Exception: malformed aggregate entries -> safe defaults.

---

### TASK P2-T02: VIEW_SKIP_INPUT_CONTRACT

**TARGET FILE**

- apps/feed-service/src/modules/feed-pipeline/dto/view-interaction.dto.ts
- apps/feed-service/src/modules/feed-pipeline/services/feed-tracking.service.ts
- apps/feed-service/src/modules/affinity/user-affinity.service.ts

**PURPOSE**

- Define deterministic producer/consumer contract for `viewMs` and `isSkip` inputs used by affinity.

**INPUT**

- Feed read tracking events.

**OUTPUT**

- Explicit DTO and integration path into `updateAffinityFromView`.

**STEP**

1. Create DTO `ViewInteractionDTO` fields:
   - `userId: string`
   - `postId: string`
   - `emotionLabel: string`
   - `viewMs: number`
   - `isSkip: boolean`
   - `timestamp: number`
2. In feed tracking service, emit/forward DTO on view completion and skip action.
3. Validate DTO:
   - `viewMs >= 0`
   - required `userId`, `postId`
4. Call affinity entrypoint:
   - `userAffinityService.updateAffinityFromView(userId, emotionLabel, viewMs, isSkip)`
5. Add guard:
   - if emotion label unavailable, no-op.

**CODE STRUCTURE**

- Add file: `view-interaction.dto.ts`
- Add function: `trackViewInteraction()`
- Modify function: feed view completion handler
- Modify function: skip handler

**LOGIC (REQUIRES Pseudocode)**

```ts
function trackViewInteraction(dto: ViewInteractionDTO) {
  if (!dto.userId || !dto.postId) return
  if (dto.viewMs < 0) return

  userAffinityService.updateAffinityFromView(
    dto.userId,
    dto.emotionLabel,
    dto.viewMs,
    dto.isSkip,
  )
}
```

**DEPENDENCES**

- Depends on Phase 1 task `P1-T04`.

**TESTING CASES**

- Input: valid DTO with `isSkip=true` -> affinity update path invoked.
- Input: valid DTO with long view -> positive update path invoked.
- Input: missing emotionLabel -> no-op.
- Exception: negative `viewMs` -> rejected.

---

### TASK P2-T03: TRENDING_VELOCITY_AND_QUALITY

**TARGET FILE**

- apps/feed-service/src/modules/ingestion/service/ingestion-stats.service.ts
- apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts
- apps/feed-service/src/modules/ranking/ranking.constants.ts

**PURPOSE**

- Detect real momentum and include lightweight quality in trending base score.

**INPUT**

- Reaction/comment/share deltas from stats events.
- Post metadata `createdAt`.
- Post media and confidence data from snapshot.

**OUTPUT**

- Updated `post:score` from engagement + freshness + corrected velocity + quality.

**STEP**

1. Define deterministic Redis storage contract:
   - `post:meta:{postId}` fields: `eng24h`, `eng7d`, `createdAt`
2. On each stats event:
   - increment `eng24h` and `eng7d` by weighted engagement delta.
3. Add one hourly cron:
   - decay `eng24h` and `eng7d` using fixed factors to approximate rolling windows.
4. Compute components:
   - `engagement = log10(1 + reactions*1 + comments*2.5 + shares*4)`
   - `freshness = 1 / (1 + 0.02 * ageHours)`
   - `engBefore24h = max(0, eng7d - eng24h)`
   - `velocity = (eng24h - engBefore24h) / max(1, engBefore24h)`
   - `velocityBoost = 1 + clamp(velocity*0.3, -0.5, 1.0)`
   - `quality = (confidence*0.5) + (hasMedia ? 0.3 : 0) + (hasVideo ? 0.2 : 0)`
5. Final formula:
   - `baseTrending = pow(engagement, 0.5) * pow(freshness, 0.3) * velocityBoost`
   - `finalTrending = baseTrending * (1 + quality)`
6. Write `finalTrending` into `post:score`.

**CODE STRUCTURE**

- Add function: `computeVelocityBoost(eng24h, eng7d)`
- Add function: `computeQualityFactor(snapshot)`
- Add function: `computeTrendingBaseScore(stats, ageHours, eng24h, eng7d, quality)`
- Modify function: `processStatsBatch()`
- Add cron function: `decayTrendingEngagementCounters()`

**LOGIC (REQUIRES Pseudocode)**

```ts
function computeVelocityBoost(eng24h, eng7d): number {
  engBefore24h = max(0, eng7d - eng24h)
  velocity = (eng24h - engBefore24h) / max(1, engBefore24h)
  return 1 + clamp(velocity * 0.3, -0.5, 1.0)
}

function computeQualityFactor(snapshot): number {
  confidence = snapshot.emotionFeature?.confidence ?? 0.5
  hasMedia = snapshot.mediaPreviews?.length > 0
  hasVideo = snapshot.mediaPreviews?.some(m => m.type === 'video') ?? false
  return confidence * 0.5 + (hasMedia ? 0.3 : 0) + (hasVideo ? 0.2 : 0)
}

function computeTrendingScore(stats, ageHours, eng24h, eng7d, snapshot): number {
  engagement = log10(1 + stats.reactions * 1 + stats.comments * 2.5 + stats.shares * 4)
  freshness = 1 / (1 + 0.02 * ageHours)
  velocityBoost = computeVelocityBoost(eng24h, eng7d)
  quality = computeQualityFactor(snapshot)

  baseTrending = pow(engagement, 0.5) * pow(freshness, 0.3) * velocityBoost
  return baseTrending * (1 + quality)
}
```

**DEPENDENCES**

- Should run after Phase 1 ranking stabilization.

**TESTING CASES**

- Input: high `eng24h` jump with low `engBefore24h` -> score boosted.
- Input: stale post with decaying engagement -> score suppressed.
- Input: same engagement but post with video and higher confidence -> higher final trending score.
- Exception: missing metadata timestamp -> fallback `ageHours = 0`.

---

## TASK EXECUTION ORDER

1. P2-T01
2. P2-T02
3. P2-T03

Dependency rules:

- P2-T02 requires Phase 1 `P1-T04` affinity entrypoint.
- P2-T03 can run in parallel with P2-T01 after Phase 1 complete.
- No circular dependencies.

---

## CONSTRAINTS

- Do not introduce Kafka redesign, ML pipelines, or external stream engines.
- Use Redis, cron jobs, existing NestJS modules, and simple formulas only.

---

## DESIGN PRINCIPLES

- Keep update functions idempotent when possible.
- Keep scoring math explicit and bounded.
- Keep storage contracts explicit before implementation.
