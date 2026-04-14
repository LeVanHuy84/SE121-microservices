from __future__ import annotations

import logging

from app.core.config import settings
from app.schemas.assistant_schema import AssistantContextItem, AssistantRespondRequest

logger = logging.getLogger("uvicorn.error")


class AssistantContextResolver:
    def resolve(self, request: AssistantRespondRequest) -> list[AssistantContextItem]:
        contexts = list(request.contexts)
        if not settings.RAG_DOCS_ENABLED:
            return contexts[: settings.CHATBOT_MAX_CONTEXT_ITEMS]

        try:
            from app.services.rag_document_service import rag_document_service

            doc_contexts = rag_document_service.search_assistant_docs(
                request.message,
                settings.RAG_DOC_TOP_K,
            )
        except Exception as exc:
            logger.warning("Assistant docs RAG skipped: %s", exc)
            return contexts[: settings.CHATBOT_MAX_CONTEXT_ITEMS]

        existing_keys = {(item.type, item.id) for item in contexts}
        for item in doc_contexts:
            key = (item.type, item.id)
            if key in existing_keys:
                continue
            contexts.append(item)
            existing_keys.add(key)

        return contexts[: settings.CHATBOT_MAX_CONTEXT_ITEMS]


assistant_context_resolver = AssistantContextResolver()
