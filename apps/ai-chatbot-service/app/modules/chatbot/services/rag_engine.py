from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from elasticsearch import AsyncElasticsearch

from app.core.settings import settings
from app.modules.chatbot.schemas import AssistantContextItem
from app.modules.chatbot.services.embedding import embedding_service
from app.utils.text_normalizer import normalize_query_text, normalize_text

logger = logging.getLogger("uvicorn.error")


@dataclass(frozen=True)
class RagDocumentChunk:
    id: str
    doc_id: str
    chunk_index: int
    title: str
    section: str
    lang: str
    updated_at: str
    visibility: str
    version: str
    type: str
    text: str
    source_path: str


class RagDocumentService:
    def __init__(self, es: AsyncElasticsearch | None = None):
        self._es = es
        self._index_exists_cache: bool | None = None
        self._index_exists_cache_expires_at: float = 0.0

    async def index_assistant_docs(self, force_reindex: bool = False) -> dict[str, int]:
        chunks, manifest_signature = self._load_markdown_chunks_with_signature()
        if not chunks:
            return {"documents": 0, "chunks": 0}

        if not force_reindex and await self._is_index_signature_unchanged(manifest_signature):
            logger.info("RAG index skipped: assistant docs signature unchanged")
            return {"documents": len({chunk.doc_id for chunk in chunks}), "chunks": 0}

        embeddings = embedding_service.encode_documents([chunk.text for chunk in chunks])
        if not embeddings:
            return {"documents": 0, "chunks": 0}

        await self._ensure_index(len(embeddings[0]))

        operations: list[dict[str, Any]] = []
        for chunk, embedding in zip(chunks, embeddings, strict=False):
            operations.append(
                {"index": {"_index": settings.RAG_INDEX_NAME, "_id": chunk.id}}
            )
            operations.append(
                {
                    "docId": chunk.doc_id,
                    "chunkIndex": chunk.chunk_index,
                    "title": chunk.title,
                    "section": chunk.section,
                    "lang": chunk.lang,
                    "updatedAt": chunk.updated_at,
                    "visibility": chunk.visibility,
                    "version": chunk.version,
                    "type": chunk.type,
                    "text": chunk.text,
                    "sourcePath": chunk.source_path,
                    "embedding": embedding,
                }
            )

        await self.es.bulk(operations=operations, refresh=True)
        self._write_index_signature(manifest_signature)
        return {"documents": len({chunk.doc_id for chunk in chunks}), "chunks": len(chunks)}

    async def search_assistant_docs(self, query: str, top_k: int | None = None) -> list[AssistantContextItem]:
        normalized_query = normalize_query_text(query)
        if not normalized_query or not await self._index_exists_cached():
            return []

        query_embedding = embedding_service.encode_query(normalized_query)
        if not query_embedding:
            return []

        resolved_top_k = top_k or settings.RAG_DOC_TOP_K
        candidate_size = max(
            resolved_top_k * settings.RAG_HYBRID_CANDIDATE_MULTIPLIER,
            resolved_top_k,
        )
        visibility = settings.RAG_DOC_SEARCH_VISIBILITY

        vector_hits = await self._search_vector(normalized_query, query_embedding, candidate_size, visibility)
        bm25_hits = await self._search_bm25(normalized_query, candidate_size, visibility)
        hybrid_candidates = self._rrf_merge([vector_hits, bm25_hits])
        reranked = self._semantic_rerank(query_embedding, hybrid_candidates)

        per_doc_limit = settings.RAG_DOC_MAX_CHUNKS_PER_DOC
        contexts: list[AssistantContextItem] = []
        chunk_count_by_doc: dict[str, int] = {}
        for hit in reranked:
            source = hit.get("_source") or {}
            doc_id = str(source.get("docId") or "")
            if not doc_id:
                continue
            used_chunks = chunk_count_by_doc.get(doc_id, 0)
            if used_chunks >= per_doc_limit:
                continue

            chunk_id = str(hit.get("_id") or "")
            if not chunk_id:
                continue

            contexts.append(
                AssistantContextItem(
                    type=str(source.get("type") or "help_doc"),
                    id=chunk_id,
                    title=source.get("title"),
                    content=str(source.get("text") or ""),
                    score=float(hit.get("_hybrid_score") or hit.get("_score") or 0),
                    source="assistant_docs",
                    metadata={
                        "docId": doc_id,
                        "section": source.get("section"),
                        "lang": source.get("lang"),
                        "updatedAt": source.get("updatedAt"),
                        "visibility": source.get("visibility"),
                        "version": source.get("version"),
                        "sourcePath": source.get("sourcePath"),
                    },
                )
            )
            chunk_count_by_doc[doc_id] = used_chunks + 1
            if len(contexts) >= resolved_top_k:
                break
        return contexts

    async def warm_up_async(self):
        if not settings.RAG_DOCS_ENABLED:
            return
        try:
            # Auto-index assistant docs on startup if signature changed or not indexed yet
            logger.info("Auto-indexing assistant documents on startup...")
            await self.index_assistant_docs(force_reindex=False)

            await self._index_exists_cached(force_refresh=True)
            embedding_service.encode_query("Tro ly Sentimeta")
            logger.info("Assistant docs RAG warmup completed")
        except Exception as exc:
            logger.warning("Assistant docs RAG warmup skipped: %s", exc)

    async def close(self):
        if self._es is not None:
            try:
                await self._es.close()
            except Exception:
                pass
            finally:
                self._es = None

    def warm_up(self):
        asyncio.run(self.warm_up_async())

    @property
    def es(self) -> AsyncElasticsearch:
        if self._es is None:
            self._es = AsyncElasticsearch(settings.ES_NODE)
        return self._es

    async def _ensure_index(self, dimensions: int):
        if await self._index_exists_cached():
            return
        await self.es.indices.create(
            index=settings.RAG_INDEX_NAME,
            mappings={
                "properties": {
                    "docId": {"type": "keyword"},
                    "chunkIndex": {"type": "integer"},
                    "title": {"type": "text"},
                    "section": {"type": "text"},
                    "lang": {"type": "keyword"},
                    "updatedAt": {"type": "keyword"},
                    "visibility": {"type": "keyword"},
                    "version": {"type": "keyword"},
                    "type": {"type": "keyword"},
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
        self._index_exists_cache = True
        self._index_exists_cache_expires_at = time.time() + 60

    async def _search_vector(
        self,
        normalized_query: str,
        query_embedding: list[float],
        candidate_size: int,
        visibility: str,
    ) -> list[dict[str, Any]]:
        del normalized_query
        result = await self.es.search(
            index=settings.RAG_INDEX_NAME,
            size=candidate_size,
            knn={
                "field": "embedding",
                "query_vector": query_embedding,
                "k": candidate_size,
                "num_candidates": max(50, candidate_size * 5),
                "filter": {"term": {"visibility": visibility}},
            },
            source=[
                "docId",
                "chunkIndex",
                "title",
                "section",
                "lang",
                "updatedAt",
                "visibility",
                "version",
                "type",
                "text",
                "sourcePath",
                "embedding",
            ],
        )
        return result.get("hits", {}).get("hits", [])

    async def _search_bm25(self, normalized_query: str, candidate_size: int, visibility: str) -> list[dict[str, Any]]:
        result = await self.es.search(
            index=settings.RAG_INDEX_NAME,
            size=candidate_size,
            query={
                "bool": {
                    "must": [
                        {
                            "multi_match": {
                                "query": normalized_query,
                                "fields": ["title^3", "section^2", "text"],
                                "type": "best_fields",
                            }
                        }
                    ],
                    "filter": [{"term": {"visibility": visibility}}],
                }
            },
            source=[
                "docId",
                "chunkIndex",
                "title",
                "section",
                "lang",
                "updatedAt",
                "visibility",
                "version",
                "type",
                "text",
                "sourcePath",
                "embedding",
            ],
        )
        return result.get("hits", {}).get("hits", [])

    def _rrf_merge(self, ranked_lists: list[list[dict[str, Any]]], k: int = 60) -> list[dict[str, Any]]:
        scores: dict[str, float] = {}
        hit_map: dict[str, dict[str, Any]] = {}
        for ranked in ranked_lists:
            for rank, hit in enumerate(ranked, start=1):
                doc_id = str(hit.get("_id") or "")
                if not doc_id:
                    continue
                scores[doc_id] = scores.get(doc_id, 0.0) + (1.0 / (k + rank))
                hit_map[doc_id] = hit
        merged = []
        for doc_id, score in sorted(scores.items(), key=lambda item: item[1], reverse=True):
            hit = hit_map[doc_id]
            hit["_hybrid_score"] = score
            merged.append(hit)
        return merged

    def _semantic_rerank(self, query_embedding: list[float], hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
        reranked: list[dict[str, Any]] = []
        for hit in hits:
            source = hit.get("_source") or {}
            embedding = source.get("embedding") or []
            cosine = self._cosine_similarity(query_embedding, embedding)
            hybrid_score = float(hit.get("_hybrid_score") or 0.0)
            hit["_hybrid_score"] = (0.65 * cosine) + (0.35 * hybrid_score)
            reranked.append(hit)
        reranked.sort(key=lambda x: float(x.get("_hybrid_score") or 0.0), reverse=True)
        return reranked

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        if not a or not b or len(a) != len(b):
            return 0.0
        vec_a = np.array(a)
        vec_b = np.array(b)
        norm_a = np.linalg.norm(vec_a)
        norm_b = np.linalg.norm(vec_b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))

    async def _index_exists_cached(self, force_refresh: bool = False) -> bool:
        now = time.time()
        if (
            not force_refresh
            and self._index_exists_cache is not None
            and self._index_exists_cache_expires_at > now
        ):
            return self._index_exists_cache
        try:
            exists = await self.es.indices.exists(index=settings.RAG_INDEX_NAME)
        except RuntimeError as exc:
            # Recover from loop-bound async client created on a closed loop.
            if "Event loop is closed" in str(exc):
                self._es = None
                exists = await self.es.indices.exists(index=settings.RAG_INDEX_NAME)
            else:
                raise
        self._index_exists_cache = bool(exists)
        self._index_exists_cache_expires_at = now + 20
        return self._index_exists_cache

    def _load_markdown_chunks_with_signature(self) -> tuple[list[RagDocumentChunk], str]:
        docs_dir = self._resolve_docs_dir()
        if not docs_dir.exists():
            return [], ""

        manifest_parts: list[str] = []
        chunks: list[RagDocumentChunk] = []

        for path in sorted(docs_dir.rglob("*.md")):
            raw_text = path.read_text(encoding="utf-8")
            metadata, body = self._parse_markdown(raw_text)
            doc_id = str(metadata.get("id") or path.stem)
            title = str(metadata.get("title") or path.stem)
            doc_type = str(metadata.get("type") or "help_doc")
            visibility = str(metadata.get("visibility") or "public")
            lang = str(metadata.get("lang") or "vi")
            version = str(metadata.get("version") or "v1")
            updated_at = str(metadata.get("updated_at") or "")
            if not updated_at:
                updated_at = time.strftime("%Y-%m-%d", time.gmtime(path.stat().st_mtime))

            sections = self._split_by_headings(body, title)
            chunk_cursor = 0
            for section_title, section_text in sections:
                semantic_chunks = self._semantic_chunk_section(section_text)
                for text in semantic_chunks:
                    chunk_id = hashlib.sha256(f"{doc_id}:{chunk_cursor}:{text}".encode()).hexdigest()
                    chunks.append(
                        RagDocumentChunk(
                            id=chunk_id,
                            doc_id=doc_id,
                            chunk_index=chunk_cursor,
                            title=title,
                            section=section_title,
                            lang=lang,
                            updated_at=updated_at,
                            visibility=visibility,
                            version=version,
                            type=doc_type,
                            text=text,
                            source_path=str(path),
                        )
                    )
                    chunk_cursor += 1

            manifest_parts.append(f"{path}:{hashlib.sha256(raw_text.encode('utf-8')).hexdigest()}")

        signature = hashlib.sha256("\n".join(manifest_parts).encode("utf-8")).hexdigest()
        return chunks, signature

    def _resolve_docs_dir(self) -> Path:
        configured = Path(settings.ASSISTANT_DOCS_DIR)
        if configured.is_absolute():
            return configured
        service_root = Path(__file__).resolve().parents[4]
        return (service_root / configured).resolve()

    def _parse_markdown(self, text: str) -> tuple[dict[str, str], str]:
        text = text.lstrip("\ufeff")
        if not text.startswith("---"):
            return {}, text
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
        if not match:
            return {}, text
        metadata: dict[str, str] = {}
        for line in match.group(1).splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip()
        return metadata, match.group(2).strip()

    def _split_by_headings(self, text: str, default_title: str) -> list[tuple[str, str]]:
        lines = text.splitlines()
        sections: list[tuple[str, list[str]]] = []
        current_title = default_title
        current_lines: list[str] = []
        heading_pattern = re.compile(r"^\s{0,3}#{1,4}\s+(.+?)\s*$")
        for line in lines:
            match = heading_pattern.match(line)
            if match:
                if current_lines:
                    sections.append((current_title, current_lines))
                current_title = normalize_text(match.group(1))
                current_lines = []
            else:
                current_lines.append(line)
        if current_lines:
            sections.append((current_title, current_lines))
        return [(title, "\n".join(part).strip()) for title, part in sections if "\n".join(part).strip()]

    def _semantic_chunk_section(self, text: str) -> list[str]:
        text = normalize_text(text)
        if not text:
            return []
        paragraphs = [normalize_text(p) for p in re.split(r"\n{2,}", text) if normalize_text(p)]
        if not paragraphs:
            return []

        embeddings = embedding_service.encode_documents(paragraphs)
        if not embeddings or len(embeddings) != len(paragraphs):
            return self._fallback_text_chunks(text)

        merged: list[str] = []
        current = paragraphs[0]
        current_embedding = embeddings[0]
        for idx in range(1, len(paragraphs)):
            candidate = paragraphs[idx]
            sim = self._cosine_similarity(current_embedding, embeddings[idx])
            next_text = f"{current}\n\n{candidate}"
            if sim >= settings.RAG_SEMANTIC_MERGE_THRESHOLD and self._estimate_tokens(next_text) <= settings.RAG_CHUNK_TOKEN_BUDGET:
                current = next_text
                current_embedding = embeddings[idx]
            else:
                merged.extend(self._enforce_token_budget(current))
                current = candidate
                current_embedding = embeddings[idx]
        merged.extend(self._enforce_token_budget(current))
        return merged

    def _enforce_token_budget(self, text: str) -> list[str]:
        if self._estimate_tokens(text) <= settings.RAG_CHUNK_TOKEN_BUDGET:
            return [text]
        return self._fallback_text_chunks(text)

    def _fallback_text_chunks(self, text: str) -> list[str]:
        normalized = normalize_text(text)
        if not normalized:
            return []
        step = max(settings.RAG_CHUNK_SIZE - settings.RAG_CHUNK_OVERLAP, 1)
        chunks: list[str] = []
        for start in range(0, len(normalized), step):
            chunk = normalized[start : start + settings.RAG_CHUNK_SIZE].strip()
            if chunk:
                chunks.append(chunk)
        return chunks

    def _estimate_tokens(self, text: str) -> int:
        words = max(1, len(normalize_text(text).split()))
        return int(words * 1.3)

    def _manifest_path(self) -> Path:
        path = Path(settings.RAG_REINDEX_MANIFEST_PATH)
        if path.is_absolute():
            return path
        service_root = Path(__file__).resolve().parents[2]
        return (service_root / path).resolve()

    async def _is_index_signature_unchanged(self, signature: str) -> bool:
        manifest_path = self._manifest_path()
        if not manifest_path.exists():
            return False
        try:
            existing = manifest_path.read_text(encoding="utf-8").strip()
            if existing != signature:
                return False
            if not await self._index_exists_cached(force_refresh=True):
                return False
            count_result = await self.es.count(index=settings.RAG_INDEX_NAME)
            return int(count_result.get("count", 0)) > 0
        except Exception:
            return False

    def _write_index_signature(self, signature: str):
        try:
            manifest_path = self._manifest_path()
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(signature, encoding="utf-8")
        except Exception as exc:
            logger.warning("Unable to write RAG manifest signature: %s", exc)


rag_document_service = RagDocumentService()
