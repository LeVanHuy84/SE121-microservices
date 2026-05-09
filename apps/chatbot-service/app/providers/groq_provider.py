from __future__ import annotations

import asyncio

from app.core.config import settings
from app.providers.base import LlmGeneration
from app.schemas.assistant_schema import AssistantRespondRequest


class GroqProvider:
    def __init__(self):
        self._chain = None

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

        chain = self._get_chain()
        response = str(chain.invoke({"input": prompt}) or "").strip()
        if not response:
            raise RuntimeError("Groq returned an empty response")
        return response

    def _get_chain(self):
        if self._chain is not None:
            return self._chain

        try:
            from langchain_core.output_parsers import StrOutputParser
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_groq import ChatGroq
        except ImportError as exc:
            raise RuntimeError(
                "LangChain Groq dependencies are not installed. "
                "Run: pip install -r requirements.txt"
            ) from exc

        llm = ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model=settings.GROQ_MODEL,
            temperature=settings.GROQ_TEMPERATURE,
            max_tokens=settings.GROQ_MAX_TOKENS,
            timeout=settings.GROQ_TIMEOUT_SECONDS,
        )
        prompt_template = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    (
                        "Bạn là AI Assistant của mạng xã hội Sentimeta. "
                        "Luôn trả lời theo ngôn ngữ của người dùng. "
                        "Ưu tiên câu trả lời ngắn gọn, rõ ràng, theo từng bước khi cần. "
                        "Chỉ dùng thông tin có trong prompt/context, không bịa dữ liệu."
                    ),
                ),
                ("human", "{input}"),
            ]
        )
        self._chain = prompt_template | llm | StrOutputParser()
        return self._chain
