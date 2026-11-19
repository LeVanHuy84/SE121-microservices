from __future__ import annotations

import asyncio
import logging
from typing import Any

import numpy as np

from app.modules.analysis.services.ml_models.text_moderation.phobert_moderator import (
    phobert_moderator,
)
from app.modules.chatbot.services.embedding import embedding_service
from app.utils.text_normalizer import normalize_for_guard, normalize_query_text

from .crisis import classify_in_chat_distress_level
from .keywords import (
    IMPLICIT_CRISIS_CENTROID_ANCHORS,
    MENTAL_HEALTH_CENTROID_ANCHORS,
    SYSTEM_GUIDE_CENTROID_ANCHORS,
)
from .types import (
    CommunityDecision,
    CrisisDecision,
    DistressLevel,
    ScopeDecision,
    Stage2VerificationResult,
)

logger = logging.getLogger("uvicorn.error")

IMPLICIT_CRISIS_COSINE_THRESHOLD = 0.84
SCOPE_PROMOTION_COSINE_THRESHOLD = 0.76
PHOBERT_EMOTIONAL_CRISIS_THRESHOLD = 0.45
PHOBERT_HATE_SPEECH_BLOCK_THRESHOLD = 0.50


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    a = np.asarray(vec_a, dtype=np.float32)
    b = np.asarray(vec_b, dtype=np.float32)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-12:
        return 0.0
    return float(np.dot(a, b) / denom)


def _mean_l2_vector(vectors: list[list[float]]) -> list[float]:
    valid = [v for v in vectors if v]
    if not valid:
        return []
    mat = np.asarray(valid, dtype=np.float32)
    mean_vec = np.mean(mat, axis=0)
    norm = float(np.linalg.norm(mean_vec))
    if norm <= 1e-12:
        return []
    return [float(x) for x in (mean_vec / norm).tolist()]


class Stage2GuardVerifier:
    """Conditional Stage 2 parallel verifier using ONNX E5 centroids and PhoBERTModerator."""

    def __init__(self) -> None:
        self._centroids: dict[str, list[float]] = {}
        self._centroid_lock = asyncio.Lock()

    async def warm_up_centroids_async(self) -> None:
        """Precompute and cache L2-normalized domain centroids."""
        if self._centroids:
            return
        async with self._centroid_lock:
            if self._centroids:
                return
            try:
                mh_vecs, sys_vecs, crisis_vecs = await asyncio.gather(
                    asyncio.gather(
                        *(
                            embedding_service.encode_query_async(anchor)
                            for anchor in MENTAL_HEALTH_CENTROID_ANCHORS
                        )
                    ),
                    asyncio.gather(
                        *(
                            embedding_service.encode_query_async(anchor)
                            for anchor in SYSTEM_GUIDE_CENTROID_ANCHORS
                        )
                    ),
                    asyncio.gather(
                        *(
                            embedding_service.encode_query_async(anchor)
                            for anchor in IMPLICIT_CRISIS_CENTROID_ANCHORS
                        )
                    ),
                )
                self._centroids = {
                    "mental_health": _mean_l2_vector(list(mh_vecs)),
                    "system_guide": _mean_l2_vector(list(sys_vecs)),
                    "implicit_crisis": _mean_l2_vector(list(crisis_vecs)),
                }
            except Exception as exc:
                logger.warning("[Stage2Guard] Centroid warm-up failed: %s", exc)

    async def verify_async(
        self,
        text: str,
        stage1_scope: ScopeDecision,
        stage1_community: CommunityDecision,
        stage1_crisis: CrisisDecision,
        topic_anchor: str | None = None,
        effective_query: str | None = None,
    ) -> Stage2VerificationResult:
        query_for_embedding = effective_query
        if query_for_embedding is None:
            tokens = text.split()
            if topic_anchor and len(tokens) <= 12:
                query_for_embedding = f"{topic_anchor} {text}".strip()
            else:
                query_for_embedding = text

        if not self._centroids:
            await self.warm_up_centroids_async()

        normalized_query_for_embedding = (
            normalize_query_text(query_for_embedding) or query_for_embedding
        )
        vec_task = embedding_service.encode_query_async(normalized_query_for_embedding)
        mod_task = phobert_moderator.infer_async(text)
        vec_res, mod_res = await asyncio.gather(
            vec_task, mod_task, return_exceptions=True
        )

        query_vec: list[float] = vec_res if isinstance(vec_res, list) else []
        mod_dict: dict[str, Any] = mod_res if isinstance(mod_res, dict) else {}

        phobert_available = bool(mod_dict.get("available", False))
        phobert_scores: dict[str, float] = (
            dict(mod_dict.get("all_scores") or {}) if phobert_available else {}
        )
        predicted_label = str(mod_dict.get("predicted_label", "CLEAN"))

        mh_sim = _cosine_similarity(query_vec, self._centroids.get("mental_health", []))
        sys_sim = _cosine_similarity(query_vec, self._centroids.get("system_guide", []))
        crisis_sim = _cosine_similarity(
            query_vec, self._centroids.get("implicit_crisis", [])
        )

        distress_level: DistressLevel = classify_in_chat_distress_level(text)
        crisis_override: CrisisDecision | None = None
        community_override: bool | None = None
        in_scope_override: bool | None = None
        matched_domains_override: tuple[str, ...] | None = None

        emotional_crisis_score = float(phobert_scores.get("EMOTIONAL_CRISIS", 0.0))
        profanity_venting_score = float(phobert_scores.get("PROFANITY_VENTING", 0.0))
        hate_speech_score = float(phobert_scores.get("HATE_SPEECH", 0.0))

        # 1. Implicit crisis semantic check (require margin over system_guide, mh_sim, and PhoBERT corroboration when available)
        if (
            query_vec
            and crisis_sim >= IMPLICIT_CRISIS_COSINE_THRESHOLD
            and crisis_sim > sys_sim + 0.05
            and (crisis_sim >= mh_sim - 0.02)
            and (not phobert_available or emotional_crisis_score >= 0.25)
        ):
            crisis_override = CrisisDecision(
                is_crisis=True,
                severity="high",
                reason="implicit_crisis_semantic",
                normalized_text=stage1_crisis.normalized_text
                or normalize_for_guard(text),
            )
            distress_level = "acute_pfa"

        # 2. PhoBERT emotional crisis -> Tier 2 Acute PFA (when not already Tier 1 Crisis)

        if (
            phobert_available
            and emotional_crisis_score >= PHOBERT_EMOTIONAL_CRISIS_THRESHOLD
            and crisis_override is None
        ):
            distress_level = "acute_pfa"

        # 3. Venting profanity vs hate speech disambiguation
        if stage1_community.reason == "profanity_candidate":
            if (
                phobert_available
                and hate_speech_score >= PHOBERT_HATE_SPEECH_BLOCK_THRESHOLD
            ):
                community_override = False
            elif (
                (
                    phobert_available
                    and (
                        predicted_label in {"PROFANITY_VENTING", "EMOTIONAL_CRISIS"}
                        or profanity_venting_score >= 0.30
                        or emotional_crisis_score >= 0.30
                    )
                )
                or distress_level != "none"
                or mh_sim >= 0.65
            ):
                community_override = True
                if distress_level == "none":
                    distress_level = (
                        "acute_pfa"
                        if emotional_crisis_score >= PHOBERT_EMOTIONAL_CRISIS_THRESHOLD
                        else "mild_cbt"
                    )

        # 4. Grey-zone scope promotion via centroid cosine
        if (
            not stage1_scope.in_scope
            and 0.15 < stage1_scope.confidence < 0.45
            and query_vec
        ):
            best_sim = max(mh_sim, sys_sim)
            if best_sim >= SCOPE_PROMOTION_COSINE_THRESHOLD:
                in_scope_override = True
                matched_domains_override = (
                    ("mental_health",) if mh_sim >= sys_sim else ("system",)
                )

        if (
            community_override is True
            and not stage1_scope.in_scope
            and in_scope_override is None
        ):
            if distress_level != "none" or mh_sim >= SCOPE_PROMOTION_COSINE_THRESHOLD:
                in_scope_override = True
                matched_domains_override = ("mental_health",)

        return Stage2VerificationResult(
            in_scope_override=in_scope_override,
            matched_domains_override=matched_domains_override,
            community_allowed_override=community_override,
            crisis_decision_override=crisis_override,
            distress_level=distress_level,
            phobert_scores=phobert_scores,
        )


stage2_guard_verifier = Stage2GuardVerifier()
