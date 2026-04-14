from __future__ import annotations

import asyncio
import json
from urllib import error, request

from app.core.config import settings
from app.providers.base import LlmGeneration
from app.schemas.assistant_schema import AssistantRespondRequest


class GroqProvider:
    async def generate(
        self,
        prompt: str,
        request: AssistantRespondRequest,
    ) -> LlmGeneration:
        del request
        content = await asyncio.to_thread(self._generate_sync, prompt)
        return LlmGeneration(
            content=content,
            model=settings.GROQ_MODEL,
            provider="groq",
        )

    def _generate_sync(self, prompt: str) -> str:
        if not settings.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set")

        payload = {
            "model": settings.GROQ_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            "temperature": settings.GROQ_TEMPERATURE,
            "max_tokens": settings.GROQ_MAX_TOKENS,
        }
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            f"{settings.GROQ_BASE_URL}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=settings.GROQ_TIMEOUT_SECONDS) as res:
                data = json.loads(res.read().decode("utf-8"))
        except error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Groq request failed: status={exc.code} body={error_body}"
            ) from exc
        except error.URLError as exc:
            raise RuntimeError(f"Groq request failed: {exc}") from exc

        response = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        response = str(response or "").strip()
        if not response:
            raise RuntimeError("Groq returned an empty response")
        return response
