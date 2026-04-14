from __future__ import annotations

import asyncio
import json
from urllib import error, request

from app.core.config import settings
from app.providers.base import LlmGeneration
from app.schemas.assistant_schema import AssistantRespondRequest


class OllamaProvider:
    async def generate(
        self,
        prompt: str,
        request: AssistantRespondRequest,
    ) -> LlmGeneration:
        del request
        content = await asyncio.to_thread(self._generate_sync, prompt)
        return LlmGeneration(
            content=content,
            model=settings.CHATBOT_MODEL,
            provider="ollama",
        )

    def _generate_sync(self, prompt: str) -> str:
        payload = {
            "model": settings.CHATBOT_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
            },
        }
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            f"{settings.OLLAMA_BASE_URL}/api/generate",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=settings.OLLAMA_TIMEOUT_SECONDS) as res:
                data = json.loads(res.read().decode("utf-8"))
        except error.URLError as exc:
            raise RuntimeError(f"Ollama request failed: {exc}") from exc

        response = str(data.get("response") or "").strip()
        if not response:
            raise RuntimeError("Ollama returned an empty response")
        return response
