from __future__ import annotations

import logging

from app.core.settings import settings
from app.modules.chatbot.schemas import AssistantContextItem, AssistantRespondRequest
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.guardrails import has_in_chat_emotional_distress
from app.utils.text_normalizer import normalize_for_guard

logger = logging.getLogger("uvicorn.error")

SYSTEM_FEATURE_DOMAINS: frozenset[str] = frozenset(
    {
        "post",
        "group",
        "chat",
        "user_social",
        "privacy",
        "notification",
        "settings_support",
        "search",
        "call",
        "auth",
    }
)


class AssistantContextResolver:
    async def resolve(
        self,
        request: AssistantRespondRequest,
        emotion_snapshot: EmotionSnapshot | None = None,
        matched_domains: tuple[str, ...] = (),
        distress_level: str = "none",
        topic_anchor: str | None = None,
    ) -> list[AssistantContextItem]:
        contexts = list(request.contexts)
        candidate_limit = settings.CHATBOT_CONTEXT_CANDIDATE_POOL_SIZE
        rag_top_k = min(
            settings.RAG_DOC_TOP_K,
            max(candidate_limit, settings.CHATBOT_MAX_CONTEXT_ITEMS),
        )

        if not settings.RAG_DOCS_ENABLED:
            return self._dedupe(contexts)[:candidate_limit]

        dense_query = request.message
        if topic_anchor and len(request.message.split()) <= 12:
            dense_query = f"{topic_anchor} {request.message}".strip()

        try:
            from app.modules.chatbot.services.rag_engine import rag_document_service

            bm25_query: str | None = None
            if self._is_mental_health_turn(
                dense_query,
                matched_domains,
                emotion_snapshot,
                distress_level=distress_level,
            ):
                bm25_query = self._expand_mental_health_query(
                    dense_query,
                    emotion_snapshot,
                    distress_level=distress_level,
                )

            doc_contexts = await rag_document_service.search_assistant_docs(
                dense_query,
                rag_top_k,
                bm25_query=bm25_query,
            )
        except Exception as exc:
            logger.warning("Assistant docs RAG skipped: %s", exc)
            return self._dedupe(contexts)[:candidate_limit]

        merged = self._merge_contexts(contexts, doc_contexts)
        ranked = self._rank_contexts(
            dense_query,
            merged,
            emotion_snapshot,
            matched_domains=matched_domains,
            distress_level=distress_level,
        )
        return ranked[:candidate_limit]

    def _is_system_turn(self, matched_domains: tuple[str, ...]) -> bool:
        return bool(set(matched_domains) & SYSTEM_FEATURE_DOMAINS)

    def _is_mental_health_turn(
        self,
        query: str,
        matched_domains: tuple[str, ...],
        emotion_snapshot: EmotionSnapshot | None,
        distress_level: str = "none",
    ) -> bool:
        if distress_level in {"mild_cbt", "acute_pfa"}:
            return True
        if has_in_chat_emotional_distress(query):
            return True
        if bool(set(matched_domains) & {"mental_health", "emotion"}):
            return True
        if not self._is_system_turn(matched_domains) and emotion_snapshot is not None:
            if emotion_snapshot.risk_level in {"high", "medium"}:
                return True
            if (
                emotion_snapshot.persistent_distress
                or emotion_snapshot.needs_proactive_checkin
            ):
                return True
            if (emotion_snapshot.primary_emotion or "").lower() in {
                "sadness",
                "fear",
                "anger",
                "disgust",
            }:
                return True
        return False

    def _expand_mental_health_query(
        self,
        query: str,
        emotion_snapshot: EmotionSnapshot | None,
        distress_level: str = "none",
    ) -> str:
        query_norm = normalize_for_guard(query)
        expansions: list[str] = []

        is_acute = (
            distress_level == "acute_pfa"
            or (
                emotion_snapshot is not None
                and (
                    emotion_snapshot.risk_level in {"high", "medium"}
                    or emotion_snapshot.persistent_distress
                )
            )
            or any(
                w in query_norm
                for w in ["kho tho", "hoang loan", "panic", "so cuu", "khung hoang"]
            )
        )
        if is_acute:
            expansions.append(
                "sơ cứu tâm lý PFA psychological first aid breathing grounding active cycle of breathing ACBT relaxation"
            )

        is_tension = any(
            w in query_norm
            for w in [
                "mat ngu",
                "khong ngu duoc",
                "cang cung",
                "cang thang",
                "met moi",
                "kiet suc",
                "burnout",
            ]
        )
        if is_tension:
            expansions.append(
                "progressive muscle relaxation PMR thư giãn cơ bắp giấc ngủ thở sâu self care"
            )

        is_sad = (
            emotion_snapshot is not None
            and (emotion_snapshot.primary_emotion or "").lower() in {"sadness", "buon"}
        ) or any(
            w in query_norm
            for w in [
                "buon",
                "chan nan",
                "co don",
                "tu ti",
                "kem coi",
                "vo dung",
                "tri hoan",
            ]
        )
        if is_sad:
            expansions.append(
                "behavioral activation kích hoạt hành vi CBT vượt qua trì hoãn chăm sóc bản thân"
            )

        is_overthinking = any(
            w in query_norm
            for w in [
                "overthinking",
                "suy nghi nhieu",
                "ap luc",
                "stress",
                "lo au",
                "bat an",
                "tu ti",
                "kem coi",
            ]
        )
        if is_overthinking:
            expansions.append(
                "CBT socratic questioning câu hỏi socratic cognitive reframing tự chăm sóc sức khỏe tinh thần"
            )

        if not expansions:
            expansions.append(
                "CBT socratic questioning câu hỏi socratic cognitive reframing tự chăm sóc sức khỏe tinh thần"
            )

        return f"{query} {' '.join(expansions)}".strip()

    def _merge_contexts(
        self,
        base_contexts: list[AssistantContextItem],
        doc_contexts: list[AssistantContextItem],
    ) -> list[AssistantContextItem]:
        merged = list(base_contexts)
        existing_keys = {(item.type, item.id) for item in merged}

        for item in doc_contexts:
            key = (item.type, item.id)
            if key in existing_keys:
                continue
            merged.append(item)
            existing_keys.add(key)

        return merged

    def _dedupe(
        self,
        contexts: list[AssistantContextItem],
    ) -> list[AssistantContextItem]:
        result: list[AssistantContextItem] = []
        seen: set[tuple[str, str]] = set()

        for item in contexts:
            key = (item.type, item.id)
            if key in seen:
                continue
            seen.add(key)
            result.append(item)

        return result

    def _rank_contexts(
        self,
        query: str,
        contexts: list[AssistantContextItem],
        emotion_snapshot: EmotionSnapshot | None = None,
        matched_domains: tuple[str, ...] = (),
        distress_level: str = "none",
    ) -> list[AssistantContextItem]:
        normalized_query = self._normalize(query)
        if not normalized_query or not contexts:
            return self._dedupe(contexts)

        is_sys = self._is_system_turn(matched_domains)
        is_mh = self._is_mental_health_turn(
            query,
            matched_domains,
            emotion_snapshot,
            distress_level=distress_level,
        )
        is_tier2_pfa = distress_level == "acute_pfa" or (
            emotion_snapshot is not None
            and (
                emotion_snapshot.risk_level in {"high", "medium"}
                or emotion_snapshot.persistent_distress
            )
        )

        ranked = []
        for item in self._dedupe(contexts):
            base_score = float(item.score or 0)
            lexical_score = self._compute_lexical_score(normalized_query, item)
            metadata = item.metadata or {}
            topic = metadata.get("topic")
            tier = metadata.get("tier")

            topic_boost = 1.0
            emotion_boost = 1.0

            # Case A: Pure System Feature Turn
            if is_sys and not is_mh:
                if tier == "system_guide" or topic == "huong-dan":
                    topic_boost = 1.4
                else:
                    topic_boost = 1.0
                emotion_boost = 1.0

            # Case C: Mixed Turn (Safety Action + Emotional Distress)
            elif is_sys and is_mh:
                if tier == "system_guide" or topic == "huong-dan":
                    topic_boost = 1.4
                elif tier == "actionable_worksheet":
                    topic_boost = 1.55 if is_tier2_pfa else 1.45
                elif tier == "clinical_reference":
                    topic_boost = 1.15
                elif tier == "background_theory":
                    topic_boost = 0.55
                elif topic == "pfa":
                    topic_boost = 1.35
                elif topic == "phuong-phap-chua-tri":
                    topic_boost = 1.2
                elif topic == "giao-trinh-chuyen-nganh":
                    topic_boost = 0.75
                else:
                    topic_boost = 1.0
                emotion_boost = 1.0

            # Case B: Mental Health Care Turn
            elif is_mh and not is_sys:
                if tier == "actionable_worksheet":
                    topic_boost = 1.55 if is_tier2_pfa else 1.45
                elif tier == "clinical_reference":
                    topic_boost = 1.15
                elif tier == "background_theory":
                    topic_boost = 0.55
                elif is_tier2_pfa:
                    if topic == "pfa":
                        topic_boost = 1.5
                    elif topic == "phuong-phap-chua-tri":
                        topic_boost = 1.2
                    elif topic == "giao-trinh-chuyen-nganh":
                        topic_boost = 0.75
                    else:
                        topic_boost = 1.0
                else:
                    # Low / none risk or emotion_snapshot is None
                    if topic in {"phuong-phap-chua-tri", "example-case"}:
                        topic_boost = 1.35
                    elif topic == "pfa":
                        topic_boost = 1.15
                    elif topic == "giao-trinh-chuyen-nganh":
                        topic_boost = 0.75
                    else:
                        topic_boost = 1.0
                emotion_boost = 1.0

            else:
                # Default / unclassified
                if topic == "giao-trinh-chuyen-nganh":
                    topic_boost = 0.8
                else:
                    topic_boost = 1.0
                emotion_boost = 1.0

            final_score = (base_score + lexical_score) * topic_boost * emotion_boost

            ranked.append(
                item.model_copy(
                    update={
                        "score": round(final_score, 6),
                    }
                )
            )

        ranked.sort(
            key=lambda item: (
                -(float(item.score or 0)),
                str(item.id),
            )
        )
        return ranked

    def _compute_lexical_score(
        self,
        normalized_query: str,
        item: AssistantContextItem,
    ) -> float:
        title = self._normalize(item.title or "")
        content = self._normalize(item.content or "")
        doc = f"{title} {content}".strip()
        if not doc:
            return 0.0

        tokens = list({token for token in normalized_query.split() if len(token) >= 2})
        if not tokens:
            raw_score = 1.2 if normalized_query in doc else 0.0
            return min(0.30, raw_score * 0.08)

        token_hits = 0
        score = 0.0

        for token in tokens:
            if token in doc:
                token_hits += 1
                score += 0.55 if token in title else 0.35

        if normalized_query in doc:
            score += 1.0

        score += (token_hits / len(tokens)) * 0.9
        return min(0.30, score * 0.08)

    def _normalize(self, value: str) -> str:
        normalized = " ".join(str(value or "").split()).lower()
        return normalized


assistant_context_resolver = AssistantContextResolver()
