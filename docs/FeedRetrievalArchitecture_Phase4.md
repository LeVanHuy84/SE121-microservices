# Feed Retrieval Architecture Phase 4

## Files Modified

- apps/feed-service/src/modules/feed-pipeline/services/personal-feed.service.ts
- apps/feed-service/src/modules/feed-pipeline/services/trending.service.ts

## New Candidate Window Logic

Implemented the safe Phase 4 variant by expanding candidate windows (without touching pagination/cursor/ranking contracts):

- Personal feed:
  - from: candidateLimit = limit * 3
  - to: candidateLimit = limit * 5
- Trending feed:
  - from: candidateLimit = limit * 3
  - to: candidateLimit = limit * 6

No changes were made to:

- cursor structure and parsing behavior
- retrieval frontier cursor progression
- ranking formulas and score blending
- snapshot repository queries
- Redis data model

## How Starvation Risk Is Reduced

Larger candidate windows allow more items to enter each ranking round before top-K selection.

This directly reduces starvation risk because:

- items just outside the old small slice now get ranked and can compete for visibility
- heavy reordering by ranking has more headroom, reducing suppression of lower-base but high-quality candidates
- repeated requests are less likely to recycle a narrow set of candidates when ranking displacement is high

## Final Retrieval Factor Limits

- Personal feed retrieval factor: 5
- Trending feed retrieval factor: 6

These factors are fixed in this phase (expanded-window approach) and are compatible with existing Phase 1 pagination correctness guarantees.
