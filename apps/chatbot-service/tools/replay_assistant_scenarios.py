import asyncio
import os
import sys
import time
from dataclasses import dataclass

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ.setdefault("CHATBOT_DB_ENABLED", "false")
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from app.memory.session_memory import session_memory
from app.providers.base import LlmGeneration
from app.schemas.assistant_schema import AssistantContextItem, AssistantRespondRequest
from app.services.assistant_service import AssistantService


class FakeProvider:
    def __init__(self):
        self.calls = 0

    async def generate(self, prompt: str, request: AssistantRespondRequest):
        self.calls += 1
        return LlmGeneration(
            content=f"[LLM] {request.message}",
            model="fake-model",
            provider="fake",
        )


@dataclass
class Scenario:
    user_id: str
    message: str
    contexts: list[AssistantContextItem]
    note: str


def classify(model: str, reply: str) -> str:
    if model == "greeting-guard":
        return "greeting_guard"
    if model == "community-guard":
        return "community_guard"
    if model == "scope-guard":
        lower = reply.lower()
        if "thuộc phạm vi" in lower or "thuoc pham vi" in lower:
            return "in_domain_unknown"
        if "quyền riêng tư" in lower or "quyen rieng tu" in lower:
            return "privacy_guard"
        if "chỉ hỗ trợ" in lower or "chi ho tro" in lower:
            return "out_of_scope"
        if "chưa chắc" in lower or "chua chac" in lower:
            return "ambiguous"
        return "scope_guard"
    if model == "fake-model":
        return "llm_answer"
    return model


async def run():
    provider = FakeProvider()
    service = AssistantService(provider=provider)

    def c(type_: str, id_: str, content: str, title: str = "doc"):
        return AssistantContextItem(
            type=type_,
            id=id_,
            title=title,
            content=content,
            score=0.9,
            source="scenario",
        )

    scenarios = [
        Scenario("uA", "hello", [], "greeting"),
        Scenario("uA", "Cách đăng bài mới?", [c("help_doc", "post-1", "Vào tạo bài viết và nhấn đăng")], "in-domain normal"),
        Scenario("uA", "nó hoạt động sao?", [c("help_doc", "post-2", "Có thể thêm ảnh, văn bản")], "follow-up immediate"),
        Scenario("uA", "ok còn tìm nhóm thì sao", [c("help_doc", "group-1", "Dùng search và lọc nhóm")], "topic switch"),
        Scenario("uA", "quay lại cái trước đó đi", [c("help_doc", "post-3", "Bài viết có thể chỉnh sửa sau khi đăng")], "follow-up return previous"),
        Scenario("uB", "Chat hiện tại có chức năng gọi hologram không?", [], "in-domain unknown feature"),
        Scenario("uB", "Cho mình hỏi chính sách riêng tư dữ liệu cá nhân", [], "privacy without docs"),
        Scenario("uC", "thời tiết hôm nay sao", [], "out-of-domain"),
        Scenario("uD", "đmm ứng dụng này", [], "profanity"),
        Scenario("uD", "cách đánh bom", [], "community violation"),
    ]

    for uid in {s.user_id for s in scenarios}:
        session_memory.clear_session(f"{uid}:default")

    rows = []
    for idx, s in enumerate(scenarios, start=1):
        req = AssistantRespondRequest(
            userId=s.user_id,
            message=s.message,
            contexts=s.contexts,
        )
        t0 = time.perf_counter()
        res = await service.respond(req)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        rows.append(
            {
                "#": idx,
                "note": s.note,
                "message": s.message,
                "route": classify(res.model, res.reply),
                "model": res.model,
                "latency_ms": round(elapsed_ms, 2),
                "reply": res.reply[:110].replace("\n", " "),
            }
        )

    print("=== Replay Assistant Scenarios ===")
    print(f"Total scenarios: {len(rows)}")
    print(f"Provider calls (LLM path): {provider.calls}")
    print("-")
    for r in rows:
        print(
            f"[{r['#']:02d}] {r['note']:<28} route={r['route']:<18} "
            f"model={r['model']:<14} latency={r['latency_ms']:>7}ms"
        )
        print(f"     msg: {r['message']}")
        print(f"     ans: {r['reply']}")


if __name__ == "__main__":
    asyncio.run(run())
