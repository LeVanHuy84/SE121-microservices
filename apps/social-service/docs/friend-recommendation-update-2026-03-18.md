# Friend Recommendation Update - 2026-03-18

This document summarizes the recommendation-system changes completed on March 18, 2026 across `social-service`, `api-gateway`, and the shared/web clients.

## 1. Ranking And Pagination Fix

### Problem

The original pagination flow applied `cursor` too early at the repository layer, before mutual-friend candidates and common-group candidates were merged and re-ranked. That caused page 2 and later pages to drift from the actual ranked order.

### Change

- `FriendRecommendationService` now fetches a larger candidate pool, merges graph and group candidates, computes final score, sorts once, and only then applies cursor slicing.
- Cursor pagination is now based on the final ranked list rather than the partial repository ordering.

### Reason

Recommendation pagination must preserve the same ordering the user sees. If ranking happens after pagination, page boundaries become unstable and users can miss or repeat candidates.

## 2. Recommendation Payload Hydration

### Problem

The recommendation API originally returned mostly `id`, `mutualFriends`, and recommendation metadata. The UI then had to fetch each user separately, which created an `N+1` request pattern.

### Change

- Recommendation responses now hydrate:
  - `user`
  - `mutualFriendPreview`
  - `commonGroups`
  - `score`
  - `reasons`
- Mutual-friend preview hydration is intentionally capped at 3 users because the UI only renders 3 preview avatars.

### Reason

The recommendation endpoint is a read-model for rendering suggestion cards. Returning a UI-ready payload reduces client latency and removes unnecessary fan-out requests from the frontend.

## 3. Persistent Dismiss / Skip

### Problem

Skip previously existed only as local UI state. Reloading the page could immediately show the same recommendation again.

### Change

- Added `friend_recommendation_dismissals`.
- Added `dismiss_friend_recommendation` flow in `social-service`.
- Added `POST /social/friends/recommend/dismiss/:targetId` in `api-gateway`.
- Recommendation queries now exclude active dismissals from both:
  - mutual-friend candidate retrieval
  - common-group candidate summarization
- Dismissals expire after 30 days instead of being permanent.

### Reason

Skip is negative feedback and needs backend persistence. A 30-day TTL avoids permanent suppression while still respecting user intent.

## 4. Recommendation Analytics Attribution

### Problem

We had no reliable way to answer:

- which recommendations were actually served
- which served items were skipped
- which served items led to a friend request
- which requests later converted to accepted friendships

We also had a contract gap: recommendation items exposed optional `recommendationId` fields in types, but those IDs were not generated or propagated through the action flow.

### Change

#### 4.1 New Tracking Model

- Added `friend_recommendation_events`.
- Event types currently tracked:
  - `served`
  - `dismissed`
  - `request_sent`
  - `accepted`

Each event stores:

- `userId`
- `candidateId`
- `eventType`
- `recommendationId`
- `recommendationRequestId`
- `metadata`
- `createdAt`

#### 4.2 Stable Recommendation Attribution IDs

- Each recommendation API response page now gets one `recommendationRequestId`.
- Each visible recommendation item now gets its own `recommendationId`.
- `served` events are recorded when visible recommendations are returned from `FriendRecommendationService`.

#### 4.3 Friend Request Attribution

- Added nullable attribution columns to `friend_requests`:
  - `recommendation_id`
  - `recommendation_request_id`
- Sending a friend request from a suggestion now stores these IDs on the pending request row.
- When the receiver accepts that request, `social-service` reads those IDs and records an `accepted` event for the original recommendee flow.

#### 4.4 Gateway / Client Contract

- `POST /social/request/:targetId` now accepts an optional body with:
  - `recommendationId`
  - `recommendationRequestId`
- `POST /social/friends/recommend/dismiss/:targetId` now accepts the same optional attribution payload.
- Shared and web clients now pass these values when the action originates from the recommendation UI.

### Reason

Tracking without attribution is low-value. A raw "request sent" metric does not tell us which recommendation it came from. By carrying `recommendationId` through the action flow and persisting it on `friend_requests`, we can measure conversion all the way from "served" to "accepted".

## 5. Shared Hook Alignment

### Problem

Several shared social hooks still used older `userService` endpoints, while the active backend contract for friendship actions lives under `friendService` / `/social/...`.

### Change

The shared hooks used by the web app were aligned to `friendService` for:

- send friend request
- accept friend request
- reject friend request
- remove friend
- block user
- unblock user

### Reason

This removes route drift between the shared client layer and the actual social-service gateway contract. It also ensures analytics events are generated from the same action path used by the UI.

## 6. Scoring Configuration

### Problem

The recommendation score originally lived as a hardcoded formula inside the service:

- `mutualFriends * 10`
- `commonGroups * 6`

This was simple, but it made tuning risky because changing recommendation behavior required editing service logic directly. It also allowed one signal to grow without bound and dominate the final score.

### Change

- Added a dedicated scoring config loader in `friend-recommendation.config.ts`.
- Added environment-backed tuning knobs:
- `FRIEND_RECOMMEND_MUTUAL_FRIEND_CAP`
- `FRIEND_RECOMMEND_COMMON_GROUP_CAP`
- `FriendRecommendationService` now computes score using capped contributions instead of unbounded multiplication.

Default behavior is now:

- mutual friends: weight `10`, cap `5`
- common groups: weight `6`, cap `3`
- diversity window size: `3`
- shared mutual-friend penalty: `4`
- source repeat penalty: `1`

### Reason

This keeps the scoring model rule-based and explainable, while making it safer to tune. Caps are important because they prevent a single dense social cluster from overwhelming all other signals.

### Diversity Reranking

After computing base score, the service now applies a lightweight deterministic rerank step to reduce repetition in the top results. The reranker currently penalizes:

- candidates that share the same mutual-friend cluster as recently selected items
- consecutive recommendations from the same source bucket

This is intentionally a small penalty layered on top of the base score rather than a full replacement of the score formula.

## 7. Recommendation Funnel Report

### Problem

After adding `friend_recommendation_events`, the system could write analytics but still had no built-in way to read funnel performance back out for tuning.

### Change

- Added repository-level aggregation for recommendation funnel analytics.
- Added service/controller/gateway flow for:
  - `get_friend_recommendation_analytics`
  - `GET /social/friends/recommend/analytics?days=30`
- Added shared API contract for recommendation analytics.

The report currently returns:

- window metadata
- totals for:
  - `served`
  - `dismissed`
  - `requestSent`
  - `accepted`
- derived rates
- source breakdown:
  - `mutual_only`
  - `group_only`
  - `mixed`
  - `fallback`

### Reason

This closes the loop between logging and decision-making. The team can now inspect whether mutual-friend suggestions, common-group suggestions, or mixed suggestions actually convert better before tuning weights further.

## 8. AI Recommendation Service

### Problem

Rule-based scoring is useful for stability and explainability, but it has a ceiling. At some point the system needs a model-based reranker that can learn better ordering from labeled recommendation outcomes.

### Change

- Added a new Python/FastAPI microservice at `apps/recommendation-service`.
- The service follows the same architectural style as `analysis-service`:
  - lazy model loading
  - warmup during lifespan startup
  - internal-key protection via `x-internal-key`
  - `transformers` + `torch` inference
- Added a new internal endpoint:
  - `POST /recommend/rerank`
- Added a new `social-service` client:
  - `RecommendationClientService`
- `FriendRecommendationService` now supports optional AI reranking:
  - base candidates are still generated and scored by rule-based logic
  - top candidates are sent to `recommendation-service`
  - returned `modelScore` is blended into the final score using configurable weight
  - if the service is missing or times out, the system falls back to rule-based ranking

### Reason

This is the safest place to introduce AI. Candidate generation remains deterministic and explainable, while the model only improves ordering. That keeps the blast radius small and avoids making recommendation availability depend entirely on model serving.

### Current Activation Model

AI reranking is controlled by:

- `FRIEND_RECOMMEND_AI_WEIGHT`
- `FRIEND_RECOMMEND_AI_TOP_K`
- `RECOMMENDATION_SERVICE_URL`
- `RECOMMENDATION_INTERNAL_KEY`

`recommendation-service` itself loads the model from:

- `RECOMMENDATION_MODEL_NAME`

This should point to the actual fine-tuned checkpoint in your environment.

## Key Files

### Backend

- `apps/social-service/src/friendship/friend-recommendation.service.ts`
- `apps/social-service/src/friendship/friend-recommendation.config.ts`
- `apps/social-service/src/friendship/friendship.service.ts`
- `apps/social-service/src/friendship/friendship.controller.ts`
- `apps/social-service/src/friendship/repositories/social-graph.repository.ts`
- `apps/social-service/src/friendship/repositories/postgres-social-graph.repository.ts`
- `apps/social-service/src/client/recommendation/recommendation-client.service.ts`
- `apps/social-service/src/client/recommendation/recommendation-client.module.ts`
- `apps/social-service/src/postgres/entities/friend-request.entity.ts`
- `apps/social-service/src/postgres/entities/friend-recommendation-dismissal.entity.ts`
- `apps/social-service/src/postgres/entities/friend-recommendation-event.entity.ts`
- `apps/api-gateway/src/modules/social/social.controller.ts`
- `apps/recommendation-service/app/main.py`
- `apps/recommendation-service/app/services/model_loader.py`
- `apps/recommendation-service/app/services/rerank_service.py`
- `apps/recommendation-service/app/api/recommend_api.py`

### Shared / Web

- `packages/shared/src/api/services/friend.service.ts`
- `packages/shared/src/hooks/useFriend.ts`
- `packages/shared/src/hooks/useUser.ts`
- `apps/web/app/(platform)/(main)/friends/suggestions/friend-suggestions.tsx`
- `apps/web/hooks/use-friend-hook.ts`
- `apps/web/lib/actions/friend/friend-action.ts`

## Validation

- `apps/social-service`: `npm test -- --runInBand`
- `packages/shared`: `npm run typecheck`
- `packages/shared`: `npm run build`

## Current Behavior

The system now supports:

- ranking-first pagination
- hydrated suggestion payloads
- persistent dismiss/skip
- configurable and capped recommendation scoring
- diversity-aware reranking to reduce repeated clusters
- optional AI reranking through a dedicated recommendation microservice
- per-item recommendation attribution IDs
- event logging for `served`, `dismissed`, `request_sent`, and `accepted`
- a usable recommendation funnel analytics endpoint

## Recommended Next Step

The next step should focus on recommendation quality:

- point `RECOMMENDATION_MODEL_NAME` to the real fine-tuned checkpoint and calibrate AI weight
- add an interaction-recency signal from upstream activity data
- add integration tests that exercise the real cross-service recommendation flow
