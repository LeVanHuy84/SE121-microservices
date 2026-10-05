from __future__ import annotations

import logging

from app.core.settings import settings
from app.modules.chatbot.schemas import AssistantContextItem, AssistantRespondRequest
from app.modules.chatbot.services.emotion_context import EmotionSnapshot

logger = logging.getLogger("uvicorn.error")


class AssistantContextResolver:
    async def resolve(
        self,
        request: AssistantRespondRequest,
        emotion_snapshot: EmotionSnapshot | None = None,
    ) -> list[AssistantContextItem]:
        contexts = list(request.contexts)
        candidate_limit = settings.CHATBOT_CONTEXT_CANDIDATE_POOL_SIZE
        rag_top_k = min(
            settings.RAG_DOC_TOP_K,
            max(candidate_limit, settings.CHATBOT_MAX_CONTEXT_ITEMS),
        )

        if not settings.RAG_DOCS_ENABLED:
            return self._dedupe(contexts)[:candidate_limit]

        try:
            from app.modules.chatbot.services.rag_engine import rag_document_service

            doc_contexts = await rag_document_service.search_assistant_docs(
                request.message,
                rag_top_k,
            )
        except Exception as exc:
            logger.warning("Assistant docs RAG skipped: %s", exc)
            return self._dedupe(contexts)[:candidate_limit]

        merged = self._merge_contexts(contexts, doc_contexts)
        ranked = self._rank_contexts(request.message, merged, emotion_snapshot)
        return ranked[:candidate_limit]

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
    ) -> list[AssistantContextItem]:
        normalized_query = self._normalize(query)
        if not normalized_query or not contexts:
            return self._dedupe(contexts)

        ranked = []
        for item in self._dedupe(contexts):
            base_score = float(item.score or 0)
            lexical_score = self._compute_lexical_score(normalized_query, item)
            
            emotion_boost = 1.0
            if emotion_snapshot and item.metadata:
                topic = item.metadata.get("topic")
                if topic == "pfa" and emotion_snapshot.risk_level in {"high", "medium"}:
                    emotion_boost = 1.5
                elif topic == "phuong-phap-chua-tri" and emotion_snapshot.primary_emotion in {"sadness", "fear", "anger"}:
                    emotion_boost = 1.3
                elif topic == "giao-trinh-chuyen-nganh":
                    emotion_boost = 0.8
                    
            final_score = (base_score + lexical_score) * emotion_boost

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
            return 1.2 if normalized_query in doc else 0.0

        token_hits = 0
        score = 0.0

        for token in tokens:
            if token in doc:
                token_hits += 1
                score += 0.55 if token in title else 0.35

        if normalized_query in doc:
            score += 1.0

        score += (token_hits / len(tokens)) * 0.9
        return score

    def _normalize(self, value: str) -> str:
        normalized = " ".join(str(value or "").split()).lower()
        return normalized


assistant_context_resolver = AssistantContextResolver()
