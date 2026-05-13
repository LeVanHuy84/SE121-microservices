from __future__ import annotations

import logging

from app.services.model_loader import model_loader

logger = logging.getLogger(__name__)


def run() -> int:
    logger.info("Starting recommendation model warmup")
    model_loader.warmup()
    readiness = model_loader.get_readiness_status()
    print("Recommendation model warmup finished")
    print(readiness)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())