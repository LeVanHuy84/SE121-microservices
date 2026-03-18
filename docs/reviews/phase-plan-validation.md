# PHASE PLAN VALIDATION REPORT

## 1. Overall Verdict

- Alignment with review: Partial
- Suitability for 2-dev project: Overkill
- Implementation feasibility: 6.5/10

Short summary (max 5 lines)

- Phase structure is mostly correct, but priority mapping is not fully aligned with the review’s Critical set.
- Several tasks add unnecessary Redis complexity for a 2-person academic team.
- Some required review items are missing (local cache TTL fix, rollout flags in critical path, quality signal in trending).
- A few task inputs are undefined in current modules (viewMs/skip source, rolling window storage semantics).
- Plans are structured well for AI parsing, but need deterministic data contracts before execution.

---

## 2. Missing or Misaligned Items

### ISSUE: Skip/Dwell Signals Priority Misplacement

- Problem: Skip/view-duration signals were moved to Phase 2.
- Expected (from review): Included under Critical Issue 1.1 (affinity flaw root cause) and should be in the earliest implementation block.
- Actual (from phase plan): Implemented in Phase 2 as P2-T02.
- Impact: Critical affinity flaw remains unresolved if only Phase 1 is executed.

### ISSUE: Affinity Local Cache Staleness Fix Missing

- Problem: No task addresses TTL/invalidation for local affinity cache map.
- Expected (from review): Quick fix in `user-affinity.service.ts` with short TTL cache behavior.
- Actual (from phase plan): Not present in any phase.
- Impact: Stale affinity can persist even after formula updates.

### ISSUE: Trending Quality Signal Omitted

- Problem: Trending formula in phases lacks quality factor.
- Expected (from review): Trending formula includes quality term `(1 + qualityScore)`.
- Actual (from phase plan): P2-T03 only uses engagement, freshness, velocity.
- Impact: Lower ranking fidelity; direct mismatch with intended improvement.

### ISSUE: Critical Rollout Flags Deferred/Incomplete

- Problem: Feature-flag rollout for risky ranking/affinity migration not in critical path.
- Expected (from review): Critical rollout controls for `USE_LINEAR_RANKING`, `USE_WINDOW_AFFINITY`.
- Actual (from phase plan): Phase 3 only adds weight override flags (P3-T03), not migration flags.
- Impact: Risky cutover; reduced safety for incremental deployment.

### ISSUE: Multi-Label Scope Incomplete

- Problem: Optional multi-label task does not include snapshot schema update.
- Expected (from review): Add secondary emotion field in snapshot schema (backward-compatible).
- Actual (from phase plan): P3-T01 only updates ranking interface/service/strategy files.
- Impact: Implementation gap; ranking may not receive persistent secondary emotion input.

---

## 3. Over-Engineering Findings ⚠️

### ITEM: Affinity Window Counter Model in Redis Hash (P2-T01)

- Why it is overkill: Per-emotion multi-counter model plus read-time cleanup introduces high implementation and correctness overhead for a small team.
- Suggested simplification: Keep existing ZSET affinity and compute 7d/30d weighted score from compact event list (or daily aggregates) with one cleanup cron.

### ITEM: Dual Rolling Counters + Hourly Bucket Cleanup for Trending (P2-T03)

- Why it is overkill: Rolling-window storage is underspecified and likely error-prone without explicit bucket schema.
- Suggested simplification: Maintain two explicit counters (`eng24h`, `eng7d`) and update/decay via one deterministic cron; avoid bucket truncation complexity.

### ITEM: Broad Strategy Refactor in Phase 1 (P1-T01)

- Why it is overkill: Touching both strategy classes and orchestrator in one step increases risk and debugging cost.
- Suggested simplification: Keep strategy classes as wrappers; centralize formula in one shared scorer utility first, then prune later.

---

## 4. Under-Engineering Findings ⚠️

- No explicit task for recency-weighted emotion preference blending with `last24hEmotionDistribution` despite review noting underuse.
- No concrete task for structured ranking explainability logs (top-N feature breakdown), only implied by `featureScores` output.
- No cold-start handling task (default-affinity bias remains).
- No explicit removal strategy for arbitrary emotion multipliers in trending path if old strategy remains partially active.

---

## 5. Internal Consistency Issues

- Undefined input source: P2-T02 requires `viewMs` and `isSkip`, but no producing module/controller/event contract is specified.
- Formula inconsistency: P2-T03 uses `velocity = (eng24h - eng7d) / eng7d`; because 7d typically contains 24h, this biases negative. Review intent is closer to `eng24h - engBefore24h`.
- Data structure ambiguity: “hourly cron cleanup for rolling windows (simple bucket truncation)” has no bucket key schema.
- File mismatch risk: Review input path requested as `docs/reviews/system-review.md` but generated source exists as `docs/reviews/SYSTEM_REVIEW.md`.
- Integration gap: P3-T01 omits schema/data persistence path for secondary emotion while ranking expects it.

---

## 6. Fix Recommendations (Actionable)

### FIX: Move Skip/Dwell to Phase 1

**Problem**

- Critical affinity flaw is delayed to Phase 2.

**Fix**

- Move P2-T02 into Phase 1 as `P1-T04`.
- Keep simple deterministic rule:
  - `skip -> -0.35`
  - `viewMs < 2000 -> -0.15`
  - `viewMs >= 5000 -> +0.10`
- If event source unavailable, implement as no-op handler with TODO contract in same phase.

**Target File(s)**

- docs/phases/phase-1-critical.md
- apps/feed-service/src/modules/affinity/user-affinity.service.ts
- apps/feed-service/src/modules/affinity/affinity.constants.ts

**Priority**

- Critical

### FIX: Add Local Affinity Cache TTL Task

**Problem**

- Stale in-memory affinity cache risk not addressed.

**Fix**

- Add Phase 1 task to enforce local cache TTL (5 minutes), stale eviction, and fallback read-through from Redis.

**Target File(s)**

- docs/phases/phase-1-critical.md
- apps/feed-service/src/modules/affinity/user-affinity.service.ts

**Priority**

- Critical

### FIX: Correct Velocity Definition

**Problem**

- Velocity formula likely biased due to overlap between 24h and 7d counters.

**Fix**

- Replace with:
  - `engBefore24h = max(0, eng7d - eng24h)`
  - `velocity = (eng24h - engBefore24h) / max(1, engBefore24h)`
  - `velocityBoost = 1 + clamp(velocity*0.3, -0.5, 1.0)`

**Target File(s)**

- docs/phases/phase-2-important.md
- apps/feed-service/src/modules/ingestion/service/ingestion-stats.service.ts

**Priority**

- Important

### FIX: Add Quality Term to Trending Formula

**Problem**

- Trending quality signal from review not implemented.

**Fix**

- Extend P2-T03 formula:
  - `quality = (confidence*0.5) + (hasMedia?0.3:0) + (hasVideo?0.2:0)`
  - `finalTrending = baseTrending * (1 + quality)`

**Target File(s)**

- docs/phases/phase-2-important.md
- apps/feed-service/src/modules/ingestion/service/ingestion-stats.service.ts
- apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts

**Priority**

- Important

### FIX: Add Migration Flags in Phase 1

**Problem**

- No safe migration switch for critical formula changes.

**Fix**

- Add Phase 1 task defining:
  - `USE_LINEAR_RANKING`
  - `USE_WINDOW_AFFINITY`
- Require dual-run compare logs before full cutover.

**Target File(s)**

- docs/phases/phase-1-critical.md
- apps/feed-service/src/modules/ranking/ranking.constants.ts
- apps/feed-service/src/modules/affinity/affinity.constants.ts

**Priority**

- Critical

### FIX: Define View/Skip Data Contract

**Problem**

- Inputs for P2-T02 are undefined in existing module boundaries.

**Fix**

- Add explicit contract task:
  - Input DTO fields: `userId`, `postId`, `emotionLabel`, `viewMs`, `isSkip`, `timestamp`
  - Producer point: feed read tracking path
  - Consumer point: affinity service method `updateAffinityFromView`

**Target File(s)**

- docs/phases/phase-2-important.md
- apps/feed-service/src/modules/feed-pipeline/dto (new DTO)
- apps/feed-service/src/modules/feed-pipeline/services (tracking integration)

**Priority**

- Critical

### FIX: Complete Multi-Label Optional Scope

**Problem**

- Optional task lacks persistence/schema change.

**Fix**

- Add schema update step for secondary emotion field with backward-compatible default null.

**Target File(s)**

- docs/phases/phase-3-optional.md
- apps/feed-service/src/mongo/schema/post-snapshot.schema.ts

**Priority**

- Optional

### FIX: Resolve Review Filename Consistency

**Problem**

- Case mismatch between requested and actual review filename can break automation.

**Fix**

- Standardize to one canonical file path and update phase validator references.

**Target File(s)**

- docs/reviews/SYSTEM_REVIEW.md or docs/reviews/system-review.md

**Priority**

- Important

---

## 7. Final Decision

- APPROVED WITH FIXES

If not APPROVED:

- List REQUIRED fixes before implementation
  - Move skip/dwell signal task into Phase 1.
  - Add local affinity cache TTL/invalidation task in Phase 1.
  - Add migration feature flags in Phase 1.
  - Correct velocity formula and define rolling-window storage contract.
  - Add explicit view/skip input contract task.
  - Add trending quality term to Phase 2 formula.
