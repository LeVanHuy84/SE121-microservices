# 🎯 Emotion-Aware Feed Recommendation System Review

**Date:** March 18, 2026  
**Scope:** 2-person academic project (1-2 week implementation horizon)  
**Focus:** Clarity, explainability, and reasonable complexity

---

## 1. Overall Assessment

### Score: **7.2/10**

**Summary:**
The system shows **solid architecture with good separation of concerns**, but suffers from:

- Oversimplified affinity tracking (count-only, no time-context)
- Too many multiplicative factors in ranking formulas (8+ variables) → unpredictable interactions
- Missing key signals: "spike detection", "skip behavior", "view duration"
- Good emotional safety layer but underpowered by weak trending baseline

**Verdict:** Functionally complete but needs **simplification and stronger foundations** before optimization.

---

## 2. Affinity System Review

### 📁 Files

- [affinity/user-affinity.service.ts](../../apps/feed-service/src/modules/affinity/user-affinity.service.ts)
- [affinity/affinity.constants.ts](../../apps/feed-service/src/modules/affinity/affinity.constants.ts)

### ✅ Strengths

1. **EMA (Exponential Moving Average) with decay:** Good temporal weighting
   - Weights recent interactions more than old ones
   - Configurable alpha (learning rate) = 0.2 default
   - Clamps to [0.01, 1.0] for safety

2. **Interaction segmentation:** Different weights for different actions

   ```
   view: 0.1, react: 0.3, comment: 0.5, share: 0.7
   ```

   → Makes intuitive sense (sharing = higher intent)

3. **Scene affinity:** Secondary signal tracking domain-specific preferences (e.g., "outdoor content")

4. **Recent emotions list:** Diversity penalty source (prevents repetition)

5. **Local cache + Redis:** Good hot-path optimization

### ❌ Weaknesses

1. **Count-only tracking (CRITICAL ISSUE)**
   - Affinity only updated on `action` (react, comment, share)
   - Missing **high-value signal: explicit skip/dismiss**
   - Cannot detect if user engaged then abandoned post mid-read
   - Example: User sees 100 joy posts but only clicks 3 → all treated equally

2. **No temporal context in EMA**
   - Same update weight at 9 AM vs. 9 PM
   - Cannot model "user prefers joy in mornings, sadness at night"
   - Alpha is global, not emotion-specific

3. **Default affinity heavily skewed toward joy (35%)**
   - Assumes all new users should see mostly joy
   - May not be appropriate for all cultures/demographics
   - Should be more balanced or configurable

4. **Scene affinity is orphaned**
   - Tracked separately but **barely used in ranking** (only 15% weight via `SCENE_AFFINITY_WEIGHT`)
   - Dominates other emotion signals without justification

5. **No decay of affinity scores over time**
   - User's affinity to "joy" stays at 0.75 forever (unless new interactions)
   - Cannot model interest drift (user obsessed with sad content → healing → back to joy)
   - Other recommendation systems use half-life (e.g., 30 days, then decay by 50%)

### 📊 Current Design

```
User Interaction (react, comment, share)
     ↓
EMA Update: affinity_new = (1 - α·weight) × affinity_old + α·weight × signal
     ↓
Redis ZSET: user:{userId}:affinity (emotion → score)
     ↓
Ranking Strategy reads affinity
```

### 💡 Suggested Improvement

**Replace pure-count with "time-weighted interaction scoring"**

**New Formula (Lightweight):**

```typescript
// Instead of: affinity[emotion] via EMA

// Compute weighted recency window:
// Recent 7 days: full weight
// 8-30 days: 0.7 weight
// 30+ days: 0.3 weight (decay)

type AffinionComponentComputation = {
  emotionLabel: string;           // "joy", "sadness", etc.

  // Window 1: Last 7 days (weight = 1.0)
  count7d: number;
  avgIntensity7d: number;         // Average emotion intensity
  totalEngagement7d: number;      // Sum of weights (3×comments + shares×4 + react×1)

  // Window 2: 8-30 days (weight = 0.7)
  count30d: number;
  avgIntensity30d: number;
  totalEngagement30d: number;

  // Computed Score
  score = (
    (count7d × 1.0 + avgIntensity7d × 0.5) +
    (count30d × 0.7 + avgIntensity30d × 0.35) × 0.5
  ) / (count7d + count30d × 0.7 + 1)  // Normalized
};
```

**Why This Works:**

- ✅ Captures **recency** without complex EMA
- ✅ Incorporates **emotion intensity** (not just counts)
- ✅ Includes **engagement weight** (comments > reactions)
- ✅ **Decays** old preferences naturally
- ✅ Simple SQL-like query: `GROUP BY emotion, dateWindow`

**Implementation:**

```typescript
// Instead of Redis ZSET, compute on-demand or cache hourly
// Pseudo-code for ranking:
computeWindow = async (userId, emotionLabel) => {
  const interactions = await db.query(
    `SELECT emotion, intensity, weight, createdAt
     FROM user_interactions
     WHERE userId = ? AND emotion = ?
     ORDER BY createdAt DESC`,
  );

  const now = Date.now();
  const score7d = interactions
    .filter((i) => now - i.createdAt < 7 * 86400000)
    .reduce((sum, i) => sum + i.weight * i.intensity, 0);

  const score30d = interactions
    .filter((i) => now - i.createdAt < 30 * 86400000)
    .reduce((sum, i) => sum + i.weight * i.intensity * 0.7, 0);

  return (score7d + score30d) / (interactions.length + 1);
};
```

---

## 3. Emotion Feature System Review

### 📁 Files

- [ranking/services/emotion-feature.service.ts](../../apps/feed-service/src/modules/ranking/services/emotion-feature.service.ts)
- [ranking/interfaces/emotion-features.interface.ts](../../apps/feed-service/src/modules/ranking/interfaces/emotion-features.interface.ts)
- [ranking/interfaces/emotion-categories.interface.ts](../../apps/feed-service/src/modules/ranking/interfaces/emotion-categories.interface.ts)

### ✅ Strengths

1. **7-category emotion model:** Clear taxonomy
   - Positive: joy, surprise
   - Negative: sadness, anger, fear, disgust
   - Neutral: neutral
   - → Interpretable and culturally agnostic

2. **Rich feature vector from analysis-service:**

   ```typescript
   {
     (userEmotionPreference, // 7-D vector [0, 1]
       last24hEmotionDistribution, // Recent interests
       negativeRatio7d, // % of negative posts in past week
       emotionVolatility7d, // Std-dev of emotions
       riskScore, // 0-1 risk assessment
       negativeStreak); // Consecutive negative posts
   }
   ```

   → Comprehensive, not just "preference"

3. **Good caching:** 1-hour TTL on emotion features
   - Balances freshness vs. latency
   - Cache invalidation on user interaction

4. **Emotional safety rules:**
   - High-risk users (risk > 0.7) → boost positive (×2.5), suppress negative (×0.3)
   - Negative streak > 3 → boost positive with factor based on streak length
   - Good mental health consideration

5. **Risk score integration at post level:**
   - Posts can have `riskHintLevel` (low, medium, high, critical)
   - Multipliers applied conditionally

### ❌ Weaknesses

1. **No temporal emotion patterns (IMPORTANT)**
   - Missing: "User prefers joy content at 9-12 AM, sadness at 10 PM"
   - All hours treated equally in preference scoring
   - Real users have circadian mood patterns

2. **Single primary emotion per post**
   - `snapshot.emotionFeature.label` = one emotion only
   - Real posts are multi-emotional: "bittersweet" (joy + sadness), "disgusted but angry"
   - Loses information, weakens ranking signal

3. **Preference vector not correlated with post intensity**
   - `userEmotionPreference[emotion]` is independent of post `intensity`
   - High preference for subtle joy (intensity=0.3) gets same boost as passionate joy (intensity=0.9)
   - Formula: `affinity × intensity` attempts to fix this but incomplete

4. **`last24hEmotionDistribution` underutilized**
   - Loaded but only used implicitly in "feature scores"
   - Not directly in ranking formula
   - Should contribute to "freshness of preference" (what user wants NOW vs. historically)

5. **Missing drift detection**
   - `negativeRatio7d` is just a ratio, no temporal slope
   - Cannot detect: "User was 80% negative 3 days ago, now 10% negative" = healing trend
   - Should boost positive content MORE when user is improving

6. **Risk scoring is coarse**
   - `riskScore` is single 0-1 value
   - No breakdown: linguistic risk, behavioral risk, temporal risk
   - Hard to debug "why did system suppress this user?"

### 📊 Current Design

```
Analysis-Service (Python)
  ├─ Analyzes user's last 30 posts
  ├─ Computes userEmotionPreference via ML
  ├─ Extracts riskScore, negativeStreak
  └─ Returns EmotionFeatures

Feed-Service
  ├─ Caches via EmotionFeatureService (1 hour)
  ├─ Used in RankingService.rankForPersonal()
  ├─ Applied as multiplier to final score
```

### 💡 Suggested Improvement

**Add time-of-day and emotional drift detection**

**1. Temporal Emotion Preference (Simple)**

```typescript
interface EmotionPreferenceWithTime {
  emotion: string;
  basePreference: number;           // Historical

  // Time-of-day windows (3 buckets)
  morningBoost: number;             // 6 AM - 12 PM
  afternoonBoost: number;           // 12 PM - 6 PM
  nightBoost: number;               // 6 PM - 6 AM

  // Recency weight
  last24hWeight: number;            // How much recent behavior overrides history
}

// In ranking:
const now = new Date();
const hour = now.getHours();

const timeWindow =
  hour >= 6 && hour < 12 ? 'morning' :
  hour >= 12 && hour < 18 ? 'afternoon' :
  'night';

const adjustedPreference =
  basePreference ×
  (1 + preference[emotion][timeWindow]) ×
  (0.7 + 0.3 * last24hWeight);  // Recency blend
```

**Why This Works:**

- ✅ Captures natural circadian patterns
- ✅ Simple lookup table (no ML)
- ✅ Personalizable without complexity

**2. Multi-Label Emotion Support (OPTIONAL, medium effort)**

```typescript
// Instead of:
emotionFeature.label = 'joy'

// Support:
emotionFeature = {
  primary: { label: 'joy', intensity: 0.85 },
  secondary?: { label: 'surprise', intensity: 0.4 },
  scores: {
    joy: 0.85,
    surprise: 0.4,
    sadness: 0.05,
    // ... rest near 0
  }
}

// In ranking - blend both:
affinity =
  (userPref[primary.label] × 0.7 × primary.intensity) +
  (userPref[secondary?.label] × 0.3 × secondary?.intensity ?? 0)
```

**3. Drift Detection (Simple)**

```typescript
// Add to EmotionFeatures:
emotionDrift: {
  negativeTrendSlope: number; // Change in negativeRatio over 7d
  positiveAcceleration: boolean; // Is user improving (healing)?
}

// Compute:
const neg7dTrajectory =
  (negRatio7d[today] - negRatio7d[7daysAgo]) / 7;

if (neg7dTrajectory < -0.02) { // Slope is negative (healing)
  // Boost positive emotion content ×1.5
  emotionalSafetyAdjustment *= 1.5;
}
```

---

## 4. Trending Detection Review

### 📁 Files

- [feed-pipeline/services/trending.service.ts](../../apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts)
- [ingestion/service/ingestion-stats.service.ts](../../apps/feed-service/src/modules/ingestion/service/ingestion-stats.service.ts)
- [ranking/ranking.constants.ts](../../apps/feed-service/src/modules/ranking/ranking.constants.ts)

### ✅ Strengths

1. **Engagement weighting makes sense:**

   ```
   reactions: ×1, comments: ×3, shares: ×4
   ```

   → Reflects user effort (sharing > commenting > liking)

2. **Freshness decay is reasonable:**

   ```
   freshness = 1 / (1 + λ × hours)
   λ = 0.025 → half-life ≈ 28 hours
   ```

   → Posts drop to 50% score after ~1 day

3. **Redis ZSET for hot ranking:** Fast leaderboard updates

4. **Emotion intensity bonus:** Emotional content gets slight viral boost

   ```
   joy: 1.2×, surprise: 1.15×, fear: 0.75×
   ```

5. **Decay cron job:** Prevents "zombie" old posts dominating

### ❌ CRITICAL Issues

1. **No spike detection (MAJOR GAP)**
   - Current formula: engagement + freshness
   - Missing: sudden acceleration in engagement
   - Example: Post with 50 reactions over 7 days (old, stale) vs. 50 reactions in 2 hours (trending NOW)
   - Both get same score under current system
   - Reddit/HN use "hotness" = engagement velocity

2. **Linear engagement weighting is weak**
   - Comment counts are summed directly (1, 2, 3 comments = 3, 6, 9 points)
   - Real viral posts follow power law
   - Small post: 5 comments → score = 15
   - Medium post: 50 comments → score = 150 (only 10× multiplier)
   - Should use `log(1 + engagement)` to compress scale

3. **Emotion multipliers are arbitrary**

   ```
   joy: 1.2, disgust: 0.8
   ```

   - Based on "viral potential" assumption (not validated)
   - Conflicts with user affinity (if user prefers disgust, why suppress it?)
   - Creates ranking distortion

4. **No content quality signal**
   - Quality score includes only: `confidence × 0.6 + hasMedia × 0.3`
   - Missing: media diversity (video > image > text?), hashtag reach, mention prominence
   - Posts with 1000 reactions but low-quality image same as high-quality viral post

5. **Emotion intensity score ignores frequency**
   - `computeEmotionBoost()` = intensity × multiplier × confidence
   - A post with joy_intensity=0.9 gets same boost regardless of how many joy posts already visible
   - Diversity penalty applied downstream but not in base trending score

### 📊 Current Formula

```
trendingScore =
  log10(reactions + comments×3 + shares×4 + 1)^0.4 ×
  (1 / (1 + 0.025 × hours))^0.2 ×
  (intensity × emotionMultiplier × confidence)^0.3 ×
  (confidence × 0.6 + hasMedia × 0.3)^0.1

(Exponential blend with base score: 0.7 weight)
```

### 💡 Suggested Improvement

**Replace with Reddit-style Hotness + Content Quality**

**Simplified Formula:**

```typescript
// 1. ENGAGEMENT SCORE (captures velocity)
const engagementScore = Math.log10(
  1 +                          // Avoid log(0)
  reactions × 1.0 +          // Likes
  comments × 2.5 +           // Comments (more engaging)
  shares × 4.0 +             // Shares (highest intent)
  saves × 1.5                // Saves (intent to return)
);

// 2. FRESHNESS WITH VELOCITY
const ageHours = (now - postCreatedAt) / 3600000;
const freshnessScore = 1 / (1 + 0.02 * ageHours); // Keeps it simple
// Half-life ≈ 35 hours

// 3. VELOCITY BONUS (spike detection)
// Compare engagement speed between first 24h vs. past 7 days
const velocity =
  (stats.reactions_24h - stats.reactions_7d) / Math.max(1, stats.reactions_7d);
// If positive = gaining momentum, negative = fading

const velocityBoost = 1 + clamp(velocity × 0.3, -0.5, 1.0);
// Faster growth → up to 2× boost
// Decay → down to 0.5× suppression

// 4. CONTENT QUALITY
const qualityScore = (
  (emotionFeature?.confidence ?? 0.5) × 0.5 +  // Emotion clarity
  (mediaPreviews.length > 0 ? 0.3 : 0) +       // Has media
  (mediaPreviews.some(m => m.type === 'video') ? 0.2 : 0)
);

// 5. FINAL TRENDING SCORE
const trendingScore =
  Math.pow(engagementScore, 0.5) ×           // Dampen engagement
  Math.pow(freshnessScore, 0.3) ×            // Moderate decay
  velocityBoost ×                             // Trending boost
  (1 + qualityScore);                         // Quality multiplier

return trendingScore;
```

**Why This Works:**

- ✅ **Velocity detection:** Catches posts gaining momentum
- ✅ **Compresses scale:** log(engagement) prevents old posts dominating
- ✅ **Quality matters:** Includes content signals
- ✅ **Explainable:** Each component has clear meaning
- ✅ **No arbitrary emotion multipliers:** Instead added in ranking layer

**Implementation Plan:**

```typescript
// File: ingestion-stats.service.ts
// When POST.STATS event received:

const stats24h = post.stats24h;  // reactions/comments/shares in past 24h
const stats7d = post.stats7d;    // Same for past 7 days

const velocity =
  (stats24h.reactions - stats7d.reactions) / Math.max(1, stats7d.reactions);

const freshness = 1 / (1 + 0.02 * ageHours);
const engagementScore = Math.log10(1 + r + c×2.5 + s×4);
const velocityBoost = 1 + clamp(velocity × 0.3, -0.5, 1.0);

const trendingScore =
  Math.pow(engagementScore, 0.5) ×
  Math.pow(freshness, 0.3) ×
  velocityBoost;

await redis.zadd('post:score', trendingScore, postId);
```

---

## 5. Ranking Strategy Review

### 📁 Files

- [ranking/services/ranking.service.ts](../../apps/feed-service/src/modules/ranking/services/ranking.service.ts)
- [ranking/strategies/personal-ranking.strategy.ts](../../apps/feed-service/src/modules/ranking/strategies/personal-ranking.strategy.ts)
- [ranking/strategies/trending-ranking.strategy.ts](../../apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts)

### ✅ Strengths

1. **Separation of concerns:** Trending vs. Personal strategies are cleanly separated

2. **Personal ranking formula is comprehensive:**

   ```
   finalScore = baseScore × affinityMultiplier × emotionalStateAdjustment ×
                freshnessDecay × diversityPenalty × engagementBoost × ...
   ```

   Includes: affinity, safety, freshness, diversity, engagement, scene, risk

3. **Good emotional safety layer:**
   - High-risk users (riskScore > 0.7): positive ×2.5, negative ×0.3
   - Negative streak > 3: positive content boosted by streak factor
   - Applies consistently to both strategies

4. **Diversity penalty prevents echo chambers:**
   - Duplicate emotion penalty: `0.95^count`
   - Vector-level cosine similarity penalty
   - Prevents showing same emotion repeatedly

5. **Confidence weighting:** Low-confidence emotion predictions are damped via sigmoid

### ❌ CRITICAL Issues

1. **Too many multiplicative factors (8+ variables)**
   - `affinityMultiplier × emotionalStateAdjustment × freshnessDecay × diversityPenalty × vectorDiversityFactor × riskMultiplier × sceneBoost × engagementBoost`
   - Each factor can swing score by 0.3–2.5×
   - Interdependencies are invisible (does affinity interact with safety? side effects?)
   - Hard to debug: if user gets low score, which factor caused it?
   - Risk: One factor (e.g., scene) dominates unexpectedly

2. **Arbitrary weighting blend in affinity computation (DESIGN FLAW)**

   ```typescript
   emotionalRelevance = 0.7 * affinity + 0.3 * preference;
   multiplier = 1 + emotionalRelevance * intensity * confidence;
   ```

   - Why 0.7/0.3 split? No justification
   - `affinity` (learned) vs. `preference` (declared) should be weighted equally or data-driven
   - Coefficient feels like tuning knob, not principled

3. **Freshness decay is exponential, hard to calibrate**

   ```typescript
   freshnessScore = Math.exp(-0.05 * hours);
   // After 24h: exp(-1.2) ≈ 0.30 (70% penalty!)
   ```

   - Very steep drop-off
   - Post from yesterday loses 70% of score
   - Conflicts with engagement signal (a post from yesterday might have viral momentum)
   - Missing: age should matter LESS if engagement is high

4. **Diversity penalty is label-only, misses vector diversity**
   - Checks if emotion label was recently seen
   - But emotion vectors are high-dimensional (7 categories × intensity × modality)
   - Two "joy" posts with different vectors (playful joy vs. relief) get same penalty
   - Vector diversity computation is mentioned but implementation unclear

5. **Scene affinity is underutilized but impactful**

   ```
   SCENE_AFFINITY_WEIGHT = 0.15 (range: [0.9, 1.15])
   ```

   - Only 15% impact overall
   - But if user has strong scene preference and post matches, boost is ×1.15
   - Contradicts modest weight: scenario = post has scene, user affinity = 1.0 → boost ×1.15
   - If scene is weak signal, why include it? If strong, why only 15%?

6. **BaseScore blending is confusing (trending strategy only)**

   ```typescript
   finalScore = baseScore^0.7 × modelScore^0.3
   ```

   - Favors baseScore (engagement) over model factors
   - Trending + personal feeds should rank differently
   - 0.7/0.3 split again: arbitrary?

7. **Feature breakdown for debugging is incomplete**
   ```typescript
   featureScores.affinity, freshness, diversity, confidenceWeight, ...
   ```

   - Returned but not used in ranking
   - Should expose breakdown to client for transparency
   - Users asking "why is this post ranked #3?" can't get answer

### 📊 Current Design

```
Personal Feed:
  baseScore (engagement) →
    × affinityMultiplier (user interest) →
    × emotionalStateAdjustment (safety) →
    × freshnessDecay (recency) →
    × diversityPenalty (novelty) →
    × engagementBoost (popular) →
    × sceneBoost (domain) →
    → finalScore

Trending Feed:
  (engagement^0.4 × freshness^0.2 × emotion^0.3 × quality^0.1) →
    × emotionalRelevance →
    × emotionalStateAdjustment →
    × riskMultiplier →
    × modalityWeight →
    [mixed with baseScore^0.7]
    → finalScore
```

### 💡 Suggested Improvement

**Simplify to 4-factor model with explicit weights**

**Unified Ranking Formula (for both personal & trending):**

```typescript
interface RankingFactors {
  engagement: number; // How popular is the post (0-1)
  freshness: number; // How recent is the post (0-1)
  affinity: number; // How much user likes this emotion (0-1)
  safety: number; // Content safety multiplier (0.3-2.5)
}

interface RankingWeights {
  w_engagement: number; // Default: 0.35
  w_freshness: number; // Default: 0.25
  w_affinity: number; // Default: 0.30
  w_safety: number; // Default: 0.10
}

// Normalize each factor to [0, 1]
const normalized = {
  engagement:
    Math.log10(stats.reactions + stats.comments * 2.5 + stats.shares * 4 + 1) /
    10,
  freshness: 1 / (1 + 0.02 * ageHours),
  affinity: clamp(userAffinity[emotion] * intensity, 0, 1),
  safety: emotionalStateAdjustment, // Already in [0.3, 2.5], normalize later
};

// Weighted sum (linear, transparent)
const baseScore =
  normalized.engagement * w_engagement +
  normalized.freshness * w_freshness +
  normalized.affinity * w_affinity +
  clamp(normalized.safety, 0, 1) * w_safety;

// Apply hard constraints
const diversityPenalty = Math.pow(0.95, recentCount);
const finalScore = baseScore * diversityPenalty;

return finalScore;
```

**Why This Works:**

- ✅ **4 interpretable factors** (vs. 8+ multiplicative)
- ✅ **Linear combination** (vs. multiplicative chaos)
- ✅ **Weights sum to 1.0** (no hidden scale)
- ✅ **Explainable:** "Post scored 0.72 = 0.40 engagement + 0.18 freshness + 0.10 affinity + 0.04 safety"
- ✅ **Tunable:** Change weights without retraining
- ✅ **Safe:** No weird interactions between factors

**Weight Recommendations:**

| Feed Type    | Engagement | Freshness | Affinity | Safety |
| ------------ | ---------- | --------- | -------- | ------ |
| **Personal** | 0.25       | 0.30      | 0.35     | 0.10   |
| **Trending** | 0.50       | 0.25      | 0.15     | 0.10   |

Personal feed prioritizes user interest (affinity).  
Trending feed prioritizes popularity (engagement).

**Implementation:**

```typescript
// File: ranking.constants.ts
export const RANKING_WEIGHTS = {
  personal: {
    w_engagement: 0.25,
    w_freshness: 0.30,
    w_affinity: 0.35,
    w_safety: 0.10,
  },
  trending: {
    w_engagement: 0.50,
    w_freshness: 0.25,
    w_affinity: 0.15,
    w_safety: 0.10,
  },
};

// File: ranking.service.ts
private computeLinearScore(
  factors: RankingFactors,
  weights: RankingWeights,
  diversityPenalty: number,
): number {
  const baseScore =
    factors.engagement * weights.w_engagement +
    factors.freshness * weights.w_freshness +
    factors.affinity * weights.w_affinity +
    clamp(factors.safety, 0, 1) * weights.w_safety;

  return baseScore * diversityPenalty;
}
```

---

## 6. System Design Review

### 📁 Architecture

- API Gateway → Feed Service → Ranking + Affinity + Emotion modules
- Ingestion layer (POST.CREATED, STATS, EMOTION_RESULT events)
- Trending service (Redis ZSET, MongoDB snapshots)

### ✅ Strengths

1. **Clean module separation:**
   - Affinity (user learning)
   - Emotion (context from analysis service)
   - Ranking (orchestration)
   - Trending (leaderboard)
     → Easy to test, modify, understand

2. **Good use of Redis:**
   - ZSET for leaderboard = O(log m) updates, O(log n + k) retrieval
   - Hash for post metadata
   - Local cache for affinity
     → Hot path optimized

3. **MongoDB for snapshots:**
   - Denormalized post data (emotion feature, stats, media)
   - Good for re-ranking where you need full context
     → No N+1 queries

4. **Event-driven updates:**
   - POST.CREATED → seed Redis
   - POST.STATS → increment Redis
   - EMOTION_RESULT → update snapshot + Redis index
     → Eventual consistency OK for feed ranking

5. **Over-fetch pattern in trending:**
   ```
   Fetch 3× limit from Redis → Re-rank → Take top limit
   ```
   → Good: ranking strategy can improve Redis ordering

### ❌ Issues

1. **Cache invalidation strategy is weak**
   - User affinity cached in local memory (`localAffinityCache` map)
   - Invalidated only on explicit call to `updateAffinity()`
   - Problem: If user reacts to post at 9:00 AM and again at 9:01 AM, one update might be missed due to race condition
   - No TTL on local cache → stale reads possible across requests

2. **Emotion preference cache is 1-hour TTL**
   - User emotional state changes (e.g., starts negative posting)
   - Feed won't adapt for up to 60 minutes
   - Should be 15-30 min for academic project (real-time learning)

3. **No feature flag / gradual rollout mechanism**
   - To change ranking weights, must push code
   - Cannot A/B test: "What if we weight affinity 0.4 instead of 0.35?"
   - For academic project: at least document how to tune weights

4. **Missing monitoring / logging**
   - No explicit metrics for "why was this post ranked #1?"
   - Debug logs exist but not structured for analysis
   - Hard to identify ranking bugs in production

5. **Trending vs. personal feed ranking is inconsistent**
   - Trending: 8+ factors, exponential blending
   - Personal: Similar but different weights
   - Makes it hard to understand why same post ranks differently
   - Should share core ranking logic

6. **ZINTERSTORE for emotion filtering is ad-hoc**
   - Creates temporary Redis keys with 5-second TTL
   - If query fails, stale keys accumulate
   - Should use Lua script for atomic operation

7. **No handling of cold-start problem**
   - New user with no interactions → `DEFAULT_USER_AFFINITY` (all joy, 35%)
   - New post with no emotion analysis yet → cannot rank by emotion
   - System will show mostly joy content until analyzed
   - Should have "onboarding" strategy

### 📊 Current Architecture

```
POST.CREATED
  → Ingestion-post-service
     → MongoDB snapshot
     → Redis ZSET 'post:score' (seed = 8)

POST.STATS
  → Ingestion-stats-service
     → Redis zincrby 'post:score'
     → MongoDB update stats

EMOTION_RESULT
  → Consumer
     → MongoDB update emotionFeature
     → Redis ZSET 'post:emotion:{emotion}:score'

GET_TRENDING/PERSONAL
  → Trending-service
     → Fetch from Redis ZSET
     → Load snapshots from MongoDB
     → Ranking-service.rankForTrending/Personal()
     → Sort & return
```

### 💡 Suggested Improvements

**1. Fix cache invalidation (QUICK FIX)**

```typescript
// File: user-affinity.service.ts

// Instead of: permanent local cache
private localAffinityCache = new Map<string, Record<string, number>>();

// Use: TTL-based cache with back-off
private readonly affinityCacheTTL = 5 * 60 * 1000; // 5 minutes
private affinityCache = new Map<string, {
  data: Record<string, number>;
  expiry: number;
}>();

async getUserAffinity(userId: string): Promise<Record<string, number>> {
  const cached = this.affinityCache.get(userId);

  // Check if valid
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  // Fetch fresh from Redis...
  const fresh = await this.redis.zrange(...);

  // Cache with TTL
  this.affinityCache.set(userId, {
    data: fresh,
    expiry: Date.now() + this.affinityCacheTTL,
  });

  return fresh;
}
```

**2. Reduce emotion cache TTL for faster learning**

```typescript
// File: emotion-feature.service.ts

const CACHE_TTL_SECONDS = 15 * 60; // Was 3600 (1 hour) → now 15 min
// Trade-off: slightly more API calls to analysis-service, but adaptive
```

**3. Add ranking weight configuration**

```typescript
// File: ranking.constants.ts

export const RANKING_WEIGHTS_CONFIG = {
  enabled: process.env.RANKING_WEIGHTS_OVERRIDE === 'true',
  personal: {
    engagement: parseFloat(process.env.W_ENGAGEMENT_PERSONAL ?? '0.25'),
    freshness: parseFloat(process.env.W_FRESHNESS_PERSONAL ?? '0.30'),
    affinity: parseFloat(process.env.W_AFFINITY_PERSONAL ?? '0.35'),
    safety: parseFloat(process.env.W_SAFETY_PERSONAL ?? '0.10'),
  },
  // Can tune via environment variables
};
```

**4. Add explicit monitoring hooks**

```typescript
// File: ranking.service.ts

async rankForPersonal(candidates, userId) {
  const rankedItems = await this.computeRanks(candidates, userId);

  // Log feature breakdown for top 3
  if (process.env.DEBUG_RANKING === 'true') {
    rankedItems.slice(0, 3).forEach((item, idx) => {
      this.logger.log({
        rank: idx + 1,
        postId: item.postId,
        finalScore: item.finalScore.toFixed(3),
        featureScores: item.featureScores,  // Log this
        timestamp: new Date().toISOString(),
      });
    });
  }

  return rankedItems;
}
```

**5. Unify ranking logic**

```typescript
// File: ranking.service.ts
// Instead of separate strategies, use same formula with different weights

async rankInternal<T extends RankingCandidate>(
  candidates: T[],
  context: RankingContext,
  feedType: 'personal' | 'trending',
): Promise<RankedItem[]> {
  const weights = this.getWeights(feedType);

  const scored = candidates
    .map(c => ({
      ...c,
      finalScore: this.computeLinearScore(
        this.extractFactors(c, context),
        weights,
      ),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);

  return scored;
}
```

---

## 7. Unified Ranking Formula (BONUS)

As suggested in the brief, here's a **simple, unified formula** for both personal and trending:

```typescript
/**
 * Unified 4-factor ranking formula
 *
 * Factors:
 * 1. Engagement: How popular (reactions, comments, shares)
 * 2. Freshness: How recent (with velocity boost)
 * 3. Affinity: User's interest in emotion
 * 4. Safety: Content safety (positive boost for high-risk users)
 *
 * Weights (tunable per feed type):
 * - Personal: affinity-heavy (0.35)
 * - Trending: engagement-heavy (0.50)
 */

interface UnifiedRankingScore {
  finalScore: number;
  breakdown: {
    engagement: number;
    freshness: number;
    affinity: number;
    safety: number;
    diversityPenalty: number;
  };
}

function computeUnifiedScore(
  candidate: RankingCandidate,
  context: RankingContext,
  weights: typeof RANKING_WEIGHTS.personal,
): UnifiedRankingScore {
  const {
    snapshot: { stats, emotionFeature, postCreatedAt },
    baseScore: redisScore,
  } = candidate;
  const { userAffinity, recentEmotions, emotionFeatures } = context;

  // ========== FACTOR 1: ENGAGEMENT ==========
  // Log-scale to avoid domination by viral posts
  const totalEngagement =
    (stats?.reactions ?? 0) * 1 +
    (stats?.comments ?? 0) * 2.5 +
    (stats?.shares ?? 0) * 4;

  const engagement = Math.min(
    1.0,
    Math.log10(totalEngagement + 1) / 5, // Normalize to [0, 1] range
  );

  // ========== FACTOR 2: FRESHNESS + VELOCITY ==========
  const hours = (Date.now() - postCreatedAt.getTime()) / 3600000;
  const freshness = 1 / (1 + 0.02 * hours); // Half-life ≈ 35 hours

  // Optional velocity boost (if stats track 24h window)
  let velocityFactor = 1.0;
  if (stats?.reactions24h !== undefined && stats?.reactions7d !== undefined) {
    const velocity =
      (stats.reactions24h - stats.reactions7d) / Math.max(1, stats.reactions7d);
    velocityFactor = 1 + Math.max(-0.5, Math.min(velocity * 0.2, 1.0));
  }

  const freshnessWithVelocity = freshness * velocityFactor;

  // ========== FACTOR 3: AFFINITY ==========
  const emotion = emotionFeature?.label ?? 'neutral';
  const intensity = emotionFeature?.intensity ?? 0.5;
  const userEmotionAffinity = userAffinity?.[emotion] ?? 0.3;

  const affinity = Math.min(1.0, userEmotionAffinity * intensity);

  // ========== FACTOR 4: SAFETY ==========
  // High-risk users see boosted positive, suppressed negative
  let safetyMultiplier = 1.0;

  const isHighRisk = (emotionFeatures?.riskScore ?? 0) > 0.7;
  const isNegative = isNegativeEmotion(emotion);
  const isPositive = isPositiveEmotion(emotion);

  if (isHighRisk) {
    safetyMultiplier = isPositive ? 2.5 : isNegative ? 0.3 : 1.0;
  } else if ((emotionFeatures?.negativeStreak ?? 0) > 3 && isPositive) {
    // Streak recovery: boost positive
    const streakDamage = Math.min(emotionFeatures!.negativeStreak / 10, 1.0);
    safetyMultiplier = 1 + streakDamage * 0.5;
  }

  // Clamp safety multiplier to [0.3, 2.5]
  const safety = Math.max(0.3, Math.min(safetyMultiplier, 2.5)) / 2.5; // Normalize

  // ========== DIVERSITY PENALTY ==========
  const emotionCount = recentEmotions?.filter((e) => e === emotion).length ?? 0;
  const diversityPenalty = Math.pow(0.95, emotionCount);

  // ========== FINAL SCORE ==========
  const baseScoreNorm = Math.min(1.0, Math.log10(redisScore + 1) / 10);

  const unweightedScore =
    engagement * weights.w_engagement +
    freshnessWithVelocity * weights.w_freshness +
    affinity * weights.w_affinity +
    safety * weights.w_safety;

  const finalScore = unweightedScore * diversityPenalty;

  return {
    finalScore,
    breakdown: {
      engagement,
      freshness: freshnessWithVelocity,
      affinity,
      safety,
      diversityPenalty,
    },
  };
}
```

**Usage:**

```typescript
// In RankingService
async rankForPersonal<T extends RankingCandidate>(
  candidates: T[],
  userId: string,
): Promise<RankedItem[]> {
  const context = await this.loadContext(userId);
  const weights = RANKING_WEIGHTS.personal;

  const scored = candidates.map(c => {
    const { finalScore, breakdown } = computeUnifiedScore(
      c,
      context,
      weights,
    );

    return {
      ...c,
      finalScore,
      featureScores: breakdown,
    };
  });

  return scored.sort((a, b) => b.finalScore - a.finalScore);
}

async rankForTrending<T extends RankingCandidate>(
  candidates: T[],
  userId: string,
): Promise<RankedItem[]> {
  const context = await this.loadContext(userId);
  const weights = RANKING_WEIGHTS.trending;  // engagement-heavy

  // Same logic, different weights
  return this.rankInternal(candidates, context, weights);
}
```

---

## 🛠️ FIX PLAN

### Priority 1: CRITICAL (Week 1)

#### **Issue 1.1: Affinity System Too Naive**

**Root Cause:**

- Only counts explicit interactions (react, comment, share)
- Ignores "skip" behavior (user dismisses post immediately)
- No time-of-day context (mood varies by hour)
- EMA learns fast but can't decay old preferences

**Fix Strategy:**

- Add 7-day and 30-day rolling windows with decay
- Score = recent_weighted(7d) + old_weighted(30d)
- Drop local affinity cache, use Redis only with 5min TTL

**Code-Level Refactor Plan:**

- Modify `user-affinity.service.ts`:
  - Replace EMA with window-based scoring
  - Add `computeWindowScore()` method
  - Cache in Redis with key: `user:{userId}:affinity:windows`
- Add to `affinity.constants.ts`: window weights

**Rollout Plan:**

- Feature flag: `USE_WINDOW_AFFINITY = true/false`
- Compute both old (EMA) and new (window) in parallel during migration
- Compare outputs weekly, then flip flag

**Priority:** CRITICAL — Affinity is foundation for personalization

---

#### **Issue 1.2: Ranking Formula Has Too Many Factors**

**Root Cause:**

- 8+ multiplicative factors (affinity × freshness × diversity × risk × scene × ...)
- Exponential blending (baseScore^0.7 × modelScore^0.3) hard to debug
- Arbitrary weights (0.7 / 0.3, 0.7 _ affinity + 0.3 _ preference)
- One factor can break entire ranking

**Fix Strategy:**

- Replace with **linear 4-factor model** (engagement, freshness, affinity, safety)
- Weights sum to 1.0
- All factors normalized to [0, 1]

**Code-Level Refactor Plan:**

- Modify `ranking.service.ts`:
  - Add `computeLinearScore()` method
  - Extract 4 factors in parallel
  - Log breakdown for debugging
- Modify `ranking.constants.ts`:
  - Add `RANKING_WEIGHTS` for personal/trending
  - Document each weight choice
- Remove old `computeScore()` from strategies (or wrap it)

**Rollout Plan:**

- Run both old and new formulas in parallel for 1 week
- Compare top-10 rankings, divergence metrics
- Flip `USE_LINEAR_RANKING` flag once confident

**Priority:** CRITICAL — Directly affects all rankings

---

### Priority 2: IMPORTANT (Week 1-2)

#### **Issue 2.1: Missing Spike Detection in Trending**

**Root Cause:**

- Current formula: engagement + freshness
- Cannot distinguish viral momentum from old engagement
- Post with 50 reactions over 7 days (stale) = same as 50 reactions in 2 hours (trending)

**Fix Strategy:**

- Add velocity bonus: (reactions_last24h - reactions_before24h) / baseline
- Implement Reddit-style hotness score

**Code-Level Refactor Plan:**

- Modify `ingestion-stats.service.ts`:
  - Track `stats24h` and `stats7d` separately in MongoDB
  - Compute velocity in `processStatsBatch()`
  - Boost score if velocity > 0
- Modify `trending-ranking.strategy.ts` or use new unified formula

**Rollout Plan:**

- Start tracking 24h stats field (backwards compatible)
- Enable velocity bonus via feature flag
- Monitor if velocity helps or hurts trending relevance

**Priority:** IMPORTANT — Makes trending feed actually trending

---

#### **Issue 2.2: Emotion Cache Too Long (1 hour)**

**Root Cause:**

- User's emotional state (riskScore, preference) cached 1 hour
- If user starts harmful posting, system waits 60 min to adapt
- Mental health feature needs faster response

**Fix Strategy:**

- Reduce cache TTL: 1 hour → 15 minutes
- Trade-off: +4 API calls/hour to analysis-service (acceptable for academic project)

**Code-Level Refactor Plan:**

- Modify `emotion-feature.service.ts`:
  - Change `CACHE_TTL_SECONDS` from 3600 to 900

**Rollout Plan:**

- Immediate change, monitor analysis-service API latency

**Priority:** Important — Affects safety responsiveness

---

### Priority 3: OPTIONAL (Week 2)

#### **Issue 3.1: Multi-Label Emotion Support**

**Root Cause:**

- Posts have single emotion label
- Real posts are "bittersweet" (joy + sadness), "confused + angry"
- System loses nuance

**Fix Strategy:**

- Support primary + secondary emotion per post
- Blend affinity: 0.7 × primary + 0.3 × secondary

**Code-Level Refactor Plan:**

- Modify post-snapshot schema: add `emotionSecondary`
- Modify ranking computation to check secondary
- No changes to upstream (analysis-service) required initially

**Rollout Plan:**

- Add field, default to null (backward compatible)
- Analysis-service can populate if it supports multi-label

**Priority:** Optional — Nice-to-have, low impact if skipped

---

#### **Issue 3.2: Temporal Emotion Preferences**

**Root Cause:**

- One affinity score per emotion globally
- Missing: user prefers joy in mornings, sadness at night
- Cannot model circadian mood patterns

**Fix Strategy:**

- Add time-window bucketing: morning/afternoon/night
- Adjust affinity based on current hour

**Code-Level Refactor Plan:**

- Extend `UserAffinity` to include time buckets
- In ranking: adjust affinity by hour of day

**Rollout Plan:**

- Requires tracking timestamp of interactions (already have)
- Implement in week 2 if time permits

**Priority:** Optional — Low priority for MVP

---

#### **Issue 3.3: Gradual Rollout mechanism**

**Root Cause:**

- Cannot A/B test ranking formula changes
- All users get new weights on deploy (risky)

**Fix Strategy:**

- Add feature flags for ranking logic
- Environment variable overrides for weights
- Log feature flags in rankings for analysis

**Code-Level Refactor Plan:**

- Extend `ranking.constants.ts` with environment overrides
- Add `@nestjs/feature-flags` library (optional)

**Rollout Plan:**

- Document all feature flags in README
- Create deployment checklist for formula changes

**Priority:** Optional — Good practice, not critical for MVP

---

## Summary: Build Plan (2 Weeks)

| Week        | Task                                           | Files                                                 | Effort |
| ----------- | ---------------------------------------------- | ----------------------------------------------------- | ------ |
| **W1-D1–2** | Replace affinity EMA with window-based scoring | `user-affinity.service.ts`, `affinity.constants.ts`   | 4h     |
| **W1-D2–3** | Implement unified 4-factor ranking formula     | `ranking.service.ts`, `personal/trending-strategy.ts` | 6h     |
| **W1-D3–5** | Add spike detection to trending score          | `ingestion-stats.service.ts`, constants               | 4h     |
| **W1-D5**   | Reduce emotion cache TTL, add monitoring       | `emotion-feature.service.ts`                          | 1h     |
| **W2-D1–2** | Testing, validation, documentation             | All ranking files                                     | 4h     |
| **W2-D3–5** | Optional: multi-label emotions & time-windows  | snapshot schema, ranking logic                        | 4h     |

**Total:** ~23 hours (2.5 days focused work)

---

## Conclusion

The system has **solid fundamentals** (event-driven, modular, Redis optimization) but needs **simplification and stronger foundations**:

1. ✅ **KEEP:** Module separation, emotional safety layer, over-fetch-then-rank pattern
2. ❌ **DISCARD:** EMA affinity, multiplicative ranking factors, arbitrary weights
3. 🛠️ **BUILD:** Window-based affinity, linear ranking formula, spike detection

Focus on **clarity and explainability** over complexity — this will help the 2-person team debug and improve the system.

Good luck! 🚀
