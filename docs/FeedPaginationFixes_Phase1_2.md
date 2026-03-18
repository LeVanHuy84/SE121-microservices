# Feed Pagination Fixes Phase 1 and 2

## Files Modified

- apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts
- apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts
- apps/feed-service/src/modules/ranking/services/ranking.service.ts

## Pagination Fix Summary (Phase 1)

### Personal feed

- Cursor generation now uses the retrieval frontier from base-ordered candidates, not the last re-ranked item.
- Cursor format updated to include deterministic tie-break fields:
  - rankingScore_createdAt_id
- Mongo sorting updated to deterministic order:
  - rankingScore DESC, createdAt DESC, \_id DESC
- Cursor predicate updated to strict frontier logic:
  - score < cursorScore
  - OR score = cursorScore and createdAt < cursorCreatedAt
  - OR score = cursorScore and createdAt = cursorCreatedAt and \_id < cursorId
- Backward compatibility retained for old 2-part cursors (score_createdAt).

### Trending feed

- Cursor parser now reads score and createdAt (and supports postId tie-break segment).
- Cursor filtering now applies deterministic in-memory tie-break logic for equal base scores using:
  - baseScore DESC, createdAt DESC, postId DESC
- Cursor generation now uses retrieval frontier candidate, not last re-ranked item.
- Cursor format now includes:
  - baseScore_createdAt_postId

## Identity Fix Summary (Phase 2)

### Personal feed candidate identity

- Ranking candidates now carry feed-item identity via candidateId (feed item \_id string).
- Ranking output preserves candidateId through generic ranking method typing.
- Mapping from ranked results to feed items now uses:
  - candidateId -> feedItem
- Removed postId-based set and postId-based find mapping path that could alias multiple feed items to one post identity.

## Why Duplicates and Skips Are Prevented

- Pagination cursor is now anchored to the scanned retrieval frontier, so page boundaries match the same ordering domain used for retrieval.
- Deterministic tie-break keys prevent unstable traversal when multiple items share identical primary score fields.
- Personal feed ranking/result mapping now resolves by unique feed-item identity, preventing post/share collisions and repeated mapping to the wrong row.

These changes fix correctness for pagination continuity and identity-safe item mapping without changing ranking formulas, emotion scoring logic, Redis data model, or snapshot schemas.
