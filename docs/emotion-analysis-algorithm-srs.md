# Emotion Analysis Module - Algorithm SRS

## 1. Emotion Profile Algorithm

### Purpose

Generate and maintain each user's long-term emotional baseline from incoming emotion aggregates, with duplicate-event protection and concurrency-safe updates.

### Input

- `emotion_aggregate`: `{ userId, id/_id, finalScores }`
- Existing user profile (if present): `{ emotionVectorEMA, dominantBaselineEmotion, negativeStreakDays, lastNegativeAt, totalAnalyses, version, lastProcessedAggregateId }`
- Configuration: `alpha` (EMA smoothing factor, default `0.2`), retry limit

### Processing Steps (step-by-step algorithm)

1. The orchestrator validates required aggregate fields (`userId`, aggregate id, `finalScores`).
2. The orchestrator loads the current profile from repository.
3. The orchestrator enforces idempotency by comparing incoming aggregate id with `lastProcessedAggregateId`.
4. If no profile exists, orchestrator calls domain service to create initial profile:
   1. Domain normalizes scores into a complete emotion vector.
   2. Domain sets dominant baseline emotion using max score.
   3. Domain initializes negative streak and counters.
5. If profile exists, orchestrator calls domain service to update profile:
   1. Domain normalizes new scores.
   2. Domain computes updated baseline with EMA per emotion: `EMA_new = alpha * current + (1 - alpha) * previous`.
   3. Domain recalculates dominant baseline emotion from updated EMA.
   4. Domain updates negative streak based on dominant emotion of current analysis and day continuity.
   5. Domain increments analysis count and refreshes timestamp.
6. The orchestrator persists changes via optimistic-concurrency repository update (`version` check) with retry loop.
7. On successful profile update/create, orchestrator can trigger snapshot recomputation workflow for the same user.

### Output

- Updated or newly created user emotion profile with EMA vector and risk-related counters.
- Processing result metadata: success/failure, created/updated flags, already-processed indicator, retry/conflict count.

## 2. Emotion Snapshot Algorithm

### Purpose

Generate time-windowed emotional state summaries (`24h`, `7d`, `30d`) from recent aggregates to support short-term monitoring and risk detection.

### Input

- `user_id`
- User profile baseline (`emotionVectorEMA`) for deviation comparison
- Emotion aggregates in time windows: fields include `createdAt`, `finalEmotion`, optional `finalScores`
- Window type: `LAST_24_HOURS`, `LAST_7_DAYS`, `LAST_30_DAYS`

### Processing Steps

1. The orchestrator loads user profile; if missing, snapshot computation stops.
2. The orchestrator queries aggregates once for last 30 days.
3. The orchestrator derives 7-day and 24-hour subsets by in-memory time filtering.
4. For each window (`30d`, `7d`, `24h`), orchestrator sends `user_id`, window aggregates, and profile to domain service.
5. The domain service computes snapshot metrics:
   1. Build emotion distribution by counting `finalEmotion` occurrences.
   2. Select dominant emotion (max count).
   3. Compute negative ratio = negative-emotion count / total aggregate count.
   4. Compute severe-negative ratio (`sadness`, `anger`, `fear`) / total count.
   5. Compute baseline deviation risk from increases of negative ratios versus profile EMA.
   6. Compute final risk score using weighted sum:
      1. `0.5 * negative_ratio`
      2. `0.3 * severe_negative_ratio`
      3. `0.2 * baseline_deviation_risk`
      4. Clamp to `[0.0, 1.0]`.
   7. Compute emotion volatility from consecutive aggregate changes (vector-distance-based when scores exist; fallback switch signal), then normalize to `[0.0, 1.0]`.
6. The orchestrator upserts one snapshot record per window.
7. If a window has no aggregates, domain returns an empty snapshot with zeroed metrics and neutral dominant emotion.

### Output

- Upserted snapshot records per time window with:
  - `emotionDistribution`
  - `dominantEmotion`
  - `negativeRatio`
  - `riskScore`
  - `emotionVolatility`
  - `computedAt`
- Batch result metadata: number of snapshots updated and processing status.
