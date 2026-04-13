from __future__ import annotations

import logging

from app.database.recommendation_state_repository import RecommendationStateRepository

logger = logging.getLogger(__name__)


def run() -> int:
    repository = RecommendationStateRepository()
    try:
        repository.validate_connection()
        repository.validate_schema()
        backfilled_count = repository.backfill_graph_pair_features()
        logger.info(
            "Backfilled recommendation pair features successfully count=%s",
            backfilled_count,
        )
        print(f"Backfilled recommendation pair features: {backfilled_count}")
        return 0
    finally:
        repository.close()


if __name__ == "__main__":
    raise SystemExit(run())