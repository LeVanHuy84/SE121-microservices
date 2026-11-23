from __future__ import annotations

import asyncio
import logging
from typing import Any

import numpy as np

from app.modules.analysis.services.ml_models.text_moderation.phobert_moderator import (
    phobert_moderator,
)
from app.modules.chatbot.services.embedding import embedding_service
from app.utils.text_normalizer import normalize_query_text

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
ZERO_CONF_MH_PROMOTION_THRESHOLD = 0.845
ZERO_CONF_MH_MARGIN_OVER_SYS = 0.018
PHOBERT_EMOTIONAL_CRISIS_THRESHOLD = 0.45
PHOBERT_HATE_SPEECH_BLOCK_THRESHOLD = 0.50

_FIRST_PERSON_PRONOUNS: tuple[str, ...] = (
    " minh ",
    " toi ",
    " em ",
    " tao ",
    " tui ",
)
_OOD_TASK_REQUEST_CUES: tuple[str, ...] = (
    " giai giup ",
    " viet ho ",
    " viet cho ",
    " tinh giup ",
    " dich giup ",
    " phuong trinh ",
    " thuat toan ",
)


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
        cached_phobert_res: dict[str, Any] | None = None,
        in_active_app_session: bool = False,
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
        if cached_phobert_res and isinstance(cached_phobert_res, dict):
            try:
                vec_res = await vec_task
            except Exception as exc:
                vec_res = exc
            mod_res = cached_phobert_res
        else:
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
        is_negated_crisis = getattr(stage1_crisis, "reason", "") == "negated_crisis"

        # 1. Implicit crisis semantic check (informs Stepped-Care Tier 2 PFA for LLM)
        # Cosine similarity and PhoBERT measure emotional distress and psychological topics.
        # They inform Tier 2 Acute PFA tone and hotline directives for the LLM rather than cutting off the turn.
        if (
            not is_negated_crisis
            and query_vec
            and crisis_sim >= IMPLICIT_CRISIS_COSINE_THRESHOLD
            and crisis_sim > sys_sim + 0.05
            and (crisis_sim >= mh_sim - 0.02)
            and (
                not phobert_available
                or emotional_crisis_score >= 0.60
                or (predicted_label == "EMOTIONAL_CRISIS" and emotional_crisis_score >= 0.45)
            )
        ):
            distress_level = "acute_pfa"
            if not stage1_scope.in_scope:
                in_scope_override = True
                matched_domains_override = ("mental_health",)

        # 2. PhoBERT Emotional Crisis -> Tier 2 Acute PFA (Stepped-Care)
        # Never let PhoBERT hijack app/system queries without lexical acute_pfa cues
        # (e.g., "đổi mật khẩu", "rời nhóm", "nhóm cho người mất ngủ") into MENTAL_HEALTH_PFA.
        from app.modules.chatbot.services.context_resolver import SYSTEM_FEATURE_DOMAINS

        has_system_domain = (
            bool(set(stage1_scope.matched_domains) & SYSTEM_FEATURE_DOMAINS)
            or in_active_app_session
        )
        if (
            phobert_available
            and not has_system_domain
            and emotional_crisis_score >= PHOBERT_EMOTIONAL_CRISIS_THRESHOLD
        ):
            distress_level = "acute_pfa"
            if not stage1_scope.in_scope:
                in_scope_override = True
                matched_domains_override = ("mental_health",)

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
                if has_system_domain:
                    matched_domains_override = stage1_scope.matched_domains
                else:
                    matched_domains_override = (
                        ("mental_health",) if mh_sim >= sys_sim else ("system",)
                    )

        # 4b. Semantic mental-health promotion for natural personal sharing with no hard Stage 1 keywords
        if (
            not stage1_scope.in_scope
            and not in_active_app_session
            and in_scope_override is None
            and not stage1_scope.matched_domains
            and stage1_scope.reason != "privacy"
            and query_vec
            and len(text.split()) >= 10
            and mh_sim >= ZERO_CONF_MH_PROMOTION_THRESHOLD
            and (mh_sim - sys_sim) >= ZERO_CONF_MH_MARGIN_OVER_SYS
        ):
            padded_norm = f" {stage1_scope.normalized_text} "
            if any(p in padded_norm for p in _FIRST_PERSON_PRONOUNS) and not any(
                cue in padded_norm for cue in _OOD_TASK_REQUEST_CUES
            ):
                in_scope_override = True
                matched_domains_override = ("mental_health",)

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
