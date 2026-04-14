from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from elasticsearch import Elasticsearch

from app.core.config import settings
from app.services.embedding_service import embedding_service
from app.schemas.assistant_schema import AssistantContextItem

logger = logging.getLogger("uvicorn.error")


@dataclass(frozen=True)
class RagDocumentChunk:
    id: str
    doc_id: str
    chunk_index: int
    title: str
    type: str
    visibility: str
    text: str
    source_path: str


class RagDocumentService:
    def __init__(self, es: Elasticsearch | None = None):
        self._es = es

    def index_assistant_docs(self) -> dict[str, int]:
        chunks = self._load_markdown_chunks()
        if not chunks:
            return {"documents": 0, "chunks": 0}

        embeddings = embedding_service.encode_documents(
            [chunk.text for chunk in chunks]
        )
        if not embeddings:
            return {"documents": 0, "chunks": 0}

        self._ensure_index(len(embeddings[0]))

        operations: list[dict[str, Any]] = []
        for chunk, embedding in zip(chunks, embeddings, strict=False):
            operations.append(
                {
                    "index": {
                        "_index": settings.RAG_INDEX_NAME,
                        "_id": chunk.id,
                    }
                }
            )
            operations.append(
                {
                    "docId": chunk.doc_id,
                    "chunkIndex": chunk.chunk_index,
                    "title": chunk.title,
                    "type": chunk.type,
                    "visibility": chunk.visibility,
                    "text": chunk.text,
                    "sourcePath": chunk.source_path,
                    "embedding": embedding,
                }
            )

        self.es.bulk(operations=operations, refresh=True)
        return {
            "documents": len({chunk.doc_id for chunk in chunks}),
            "chunks": len(chunks),
        }

    def search_assistant_docs(
        self,
        query: str,
        top_k: int | None = None,
    ) -> list[AssistantContextItem]:
        normalized_query = query.strip()
        if not normalized_query:
            return []

        if not self.es.indices.exists(index=settings.RAG_INDEX_NAME):
            return []

        query_embedding = embedding_service.encode_query(normalized_query)
        if not query_embedding:
            return []

        resolved_top_k = top_k or settings.RAG_DOC_TOP_K
        result = self.es.search(
            index=settings.RAG_INDEX_NAME,
            size=resolved_top_k,
            knn={
                "field": "embedding",
                "query_vector": query_embedding,
                "k": resolved_top_k,
                "num_candidates": max(50, resolved_top_k * 10),
            },
            _source=[
                "docId",
                "title",
                "type",
                "visibility",
                "text",
                "sourcePath",
            ],
        )
        hits = result.get("hits", {}).get("hits", [])
        contexts: list[AssistantContextItem] = []
        for hit in hits:
            source = hit.get("_source") or {}
            contexts.append(
                AssistantContextItem(
                    type=str(source.get("type") or "help_doc"),
                    id=str(source.get("docId") or hit.get("_id")),
                    title=source.get("title"),
                    content=str(source.get("text") or ""),
                    score=float(hit.get("_score") or 0),
                    source="assistant_docs",
                    metadata={
                        "visibility": source.get("visibility"),
                        "sourcePath": source.get("sourcePath"),
                    },
                )
            )
        return contexts

    def warm_up(self):
        if not settings.RAG_DOCS_ENABLED:
            return

        try:
            if not self.es.indices.exists(index=settings.RAG_INDEX_NAME):
                logger.info(
                    "Assistant docs RAG warmup skipped: index %s does not exist",
                    settings.RAG_INDEX_NAME,
                )
                return

            embedding_service.encode_query("Sentimeta assistant")
            logger.info("Assistant docs RAG warmup completed")
        except Exception as exc:
            logger.warning("Assistant docs RAG warmup skipped: %s", exc)

    @property
    def es(self) -> Elasticsearch:
        if self._es is None:
            self._es = Elasticsearch(settings.ES_NODE)
        return self._es

    def _ensure_index(self, dimensions: int):
        if self.es.indices.exists(index=settings.RAG_INDEX_NAME):
            return

        self.es.indices.create(
            index=settings.RAG_INDEX_NAME,
            mappings={
                "properties": {
                    "docId": {"type": "keyword"},
                    "chunkIndex": {"type": "integer"},
                    "title": {"type": "text"},
                    "type": {"type": "keyword"},
                    "visibility": {"type": "keyword"},
                    "text": {"type": "text"},
                    "sourcePath": {"type": "keyword"},
                    "embedding": {
                        "type": "dense_vector",
                        "dims": dimensions,
                        "index": True,
                        "similarity": "cosine",
                    },
                }
            },
        )

    def _load_markdown_chunks(self) -> list[RagDocumentChunk]:
        docs_dir = self._resolve_docs_dir()
        if not docs_dir.exists():
            return []

        chunks: list[RagDocumentChunk] = []
        for path in sorted(docs_dir.glob("*.md")):
            metadata, body = self._parse_markdown(path)
            doc_id = str(metadata.get("id") or path.stem)
            title = str(metadata.get("title") or path.stem)
            doc_type = str(metadata.get("type") or "help_doc")
            visibility = str(metadata.get("visibility") or "public")
            for index, text in enumerate(self._chunk_text(body)):
                chunk_id = hashlib.sha256(
                    f"{doc_id}:{index}:{text}".encode("utf-8")
                ).hexdigest()
                chunks.append(
                    RagDocumentChunk(
                        id=chunk_id,
                        doc_id=doc_id,
                        chunk_index=index,
                        title=title,
                        type=doc_type,
                        visibility=visibility,
                        text=text,
                        source_path=str(path),
                    )
                )
        return chunks

    def _resolve_docs_dir(self) -> Path:
        configured = Path(settings.ASSISTANT_DOCS_DIR)
        if configured.is_absolute():
            return configured

        service_root = Path(__file__).resolve().parents[2]
        return (service_root / configured).resolve()

    def _parse_markdown(self, path: Path) -> tuple[dict[str, str], str]:
        text = path.read_text(encoding="utf-8")
        if not text.startswith("---"):
            return {}, text

        match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
        if not match:
            return {}, text

        metadata: dict[str, str] = {}
        for line in match.group(1).splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip()
        return metadata, match.group(2).strip()

    def _chunk_text(self, text: str) -> list[str]:
        normalized = "\n".join(line.strip() for line in text.splitlines()).strip()
        if not normalized:
            return []

        chunks: list[str] = []
        start = 0
        while start < len(normalized):
            end = min(len(normalized), start + settings.RAG_CHUNK_SIZE)
            chunks.append(normalized[start:end].strip())
            if end == len(normalized):
                break
            start = end - settings.RAG_CHUNK_OVERLAP
        return [chunk for chunk in chunks if chunk]


rag_document_service = RagDocumentService()
