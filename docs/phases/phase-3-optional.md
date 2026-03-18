# PHASE 3: OPTIONAL OPTIMIZATION

## OBJECTIVES

- Add optional expressiveness for emotion representation.
- Improve personalization quality with time-bucket affinity.
- Add runtime tuning controls without architecture expansion.

---

## TASKS LIST

### TASK P3-T01: MULTI_LABEL_EMOTION_LIGHT

**TARGET FILE**

- apps/feed-service/src/mongo/schema/post-snapshot.schema.ts
- apps/feed-service/src/modules/ranking/interfaces/ranking-strategy.interface.ts
- apps/feed-service/src/modules/ranking/strategies/personal-ranking.strategy.ts
- apps/feed-service/src/modules/ranking/services/ranking.service.ts

**PURPOSE**

- Support primary + secondary emotion signals with simple blending and backward-compatible persistence.

**INPUT**

- Existing `emotionFeature.label`
- Existing `emotionFeature.scores`

**OUTPUT**

- Persisted optional secondary emotion field.
- Affinity factor uses blended primary/secondary emotion relevance.

**STEP**

1. Update post snapshot schema:
   - Add optional `emotionFeature.secondaryLabel?: string | null`
   - Add optional `emotionFeature.secondaryIntensity?: number | null`
2. Keep schema backward-compatible:
   - default `null`
   - no migration hard-stop
3. Derive top-2 emotions from `scores` when available.
4. Compute blended emotion affinity:
   - `affinityBlend = affinity(primary)*0.7 + affinity(secondary)*0.3`
5. If secondary missing, fallback to primary only.
6. Keep all outputs normalized.

**CODE STRUCTURE**

- Modify schema: `post-snapshot.schema.ts`
- Add function: `extractTopTwoEmotions()`
- Add function: `computeBlendedEmotionAffinity()`
- Modify function: `normalizeAffinity()` in ranking path

**LOGIC (REQUIRES Pseudocode)**

```ts
function computeBlendedEmotionAffinity(scores, userAffinity): number {
  [primary, secondary] = extractTopTwoEmotions(scores)
  if (!primary) return 0.3

  p = (userAffinity[primary.label] ?? 0.3) * primary.value
  s = secondary ? (userAffinity[secondary.label] ?? 0.3) * secondary.value : 0

  return clamp(p * 0.7 + s * 0.3, 0, 1)
}
```

**DEPENDENCES**

- Requires Phase 1 linear ranking active.

**TESTING CASES**

- Input: joy=0.8, surprise=0.6 -> blended > joy-only baseline if both preferred.
- Input: only one emotion score -> fallback primary-only.
- Input: old snapshot without secondary fields -> no crash, same behavior as before.
- Exception: invalid scores map -> default affinity 0.3.

---

### TASK P3-T02: TIME_BUCKET_AFFINITY

**TARGET FILE**

- apps/feed-service/src/modules/affinity/user-affinity.service.ts
- apps/feed-service/src/modules/affinity/affinity.constants.ts
- apps/feed-service/src/modules/ranking/services/ranking.service.ts

**PURPOSE**

- Adjust affinity by simple day-part behavior: morning/afternoon/night.

**INPUT**

- Interaction timestamps
- Current request time
- Base affinity per emotion

**OUTPUT**

- Time-adjusted affinity factor in ranking.

**STEP**

1. Define buckets:
   - morning: 06-11
   - afternoon: 12-17
   - night: 18-05
2. Track affinity counters per bucket in Redis.
3. On ranking, resolve current bucket and apply boost:
   - `adjusted = baseAffinity * (1 + bucketBoost)`
4. Clamp adjusted affinity to `[0, 1]`.
5. Keep fallback to base affinity when bucket data missing.

**CODE STRUCTURE**

- Add function: `resolveTimeBucket(hour)`
- Add function: `getBucketAffinityBoost(userId, emotion, bucket)`
- Modify function: `normalizeAffinity()` to include bucket boost

**LOGIC (REQUIRES Pseudocode)**

```ts
function resolveTimeBucket(hour): 'morning' | 'afternoon' | 'night' {
  if (hour >= 6 && hour <= 11) return 'morning'
  if (hour >= 12 && hour <= 17) return 'afternoon'
  return 'night'
}

function applyTimeBucketAffinity(baseAffinity, bucketBoost): number {
  return clamp(baseAffinity * (1 + bucketBoost), 0, 1)
}
```

**DEPENDENCES**

- Can run after Phase 2 affinity windows.

**TESTING CASES**

- Input: high morning joy boost -> morning joy rank increases.
- Input: no bucket data -> ranking unchanged from base.
- Exception: invalid hour -> default night bucket.

---

### TASK P3-T03: WEIGHT_OVERRIDE_FLAGS

**TARGET FILE**

- apps/feed-service/src/modules/ranking/ranking.constants.ts
- apps/feed-service/src/modules/ranking/services/ranking.service.ts

**PURPOSE**

- Enable runtime tuning of ranking weights via environment variables.

**INPUT**

- Process env values for each weight.

**OUTPUT**

- Runtime-selected weight config with strict validation.

**STEP**

1. Add optional env parser for weight override.
2. Validate sum of weights equals 1.0 within tolerance `0.001`.
3. If invalid config, fallback to default static constants.
4. Log active weight source once on service init.

**CODE STRUCTURE**

- Add function: `readWeightOverrides()`
- Add function: `validateWeights()`
- Modify constructor/init path in `ranking.service.ts`

**LOGIC (REQUIRES Pseudocode)**

```ts
function validateWeights(w): boolean {
  if (w.engagement < 0 || w.freshness < 0 || w.affinity < 0 || w.safety < 0) return false
  total = w.engagement + w.freshness + w.affinity + w.safety
  return abs(total - 1.0) <= 0.001
}

function resolveWeights(defaultWeights, envWeights): Weights {
  if (envWeights && validateWeights(envWeights)) return envWeights
  return defaultWeights
}
```

**DEPENDENCES**

- Requires Phase 1 linear ranking formula.

**TESTING CASES**

- Input: valid env weights sum=1 -> env weights active.
- Input: invalid env weights sum!=1 -> fallback defaults.
- Exception: non-numeric env values -> fallback defaults.

---

## TASK EXECUTION ORDER

1. P3-T01
2. P3-T02
3. P3-T03

Dependency rules:

- P3-T01 depends on Phase 1 score pipeline.
- P3-T02 should execute after Phase 2 affinity upgrades.
- P3-T03 depends on Phase 1 weight-based scoring.
- No circular dependencies.

---

## CONSTRAINTS

- No new event systems.
- No ML training or inference changes.
- No cross-service architecture rewrite.

---

## DESIGN PRINCIPLES

- Preserve backward compatibility by default.
- Guard all optional logic behind safe fallbacks.
- Keep all optional features removable without side effects.
