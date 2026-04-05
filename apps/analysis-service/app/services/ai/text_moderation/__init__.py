# app/services/ai/text_moderation/__init__.py

from .phobert_moderator import (
    phobert_moderator,
    ensure_phobert_moderator_loaded,
)
from .keyword_moderator import KeywordModerator
from .moderation_aggregator import ModerationAggregator

# -------------------------------------------------
# Optional auto warmup
# -------------------------------------------------

AUTO_WARMUP = True

if AUTO_WARMUP:
    ensure_phobert_moderator_loaded()

# -------------------------------------------------
# Composition root
# -------------------------------------------------

keyword_moderator = KeywordModerator()

moderation_aggregator = ModerationAggregator(
    phobert=phobert_moderator,
    keyword=keyword_moderator,
)

# -------------------------------------------------
# Public exports
# -------------------------------------------------

__all__ = [
    "moderation_aggregator",
]
