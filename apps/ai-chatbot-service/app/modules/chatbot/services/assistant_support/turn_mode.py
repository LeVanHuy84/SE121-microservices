from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from app.modules.chatbot.navigation.resolver import (
    _DATA_RETRIEVAL_INDICATORS,
    _HOWTO_INDICATORS,
    _VIEW_DATA_PREFIXES,
)
from app.modules.chatbot.services.context_resolver import SYSTEM_FEATURE_DOMAINS
from app.utils.text_normalizer import normalize_for_guard


class TurnMode(str, Enum):
    """Canonical single-source-of-truth routing mode for each assistant turn."""

    CRISIS = "crisis"
    POLICY_RESTRICTED = "policy_restricted"
    NAVIGATION = "navigation"
    MENTAL_HEALTH_PFA = "mental_health_pfa"
    MIXED_SUPPORT_APP = "mixed_support_app"
    USER_DATA = "user_data"
    APP_GUIDE = "app_guide"
    MENTAL_HEALTH_CBT = "mental_health_cbt"
    GENERAL_FALLBACK = "general_fallback"


@dataclass(frozen=True, slots=True)
class TurnModeSignals:
    message: str
    scope_in_scope: bool
    scope_state: str
    matched_domains: tuple[str, ...]
    distress_level: str = "none"
    has_in_chat_distress: bool = False
    has_active_session_anchor: bool = False
    has_howto_nav: bool = False
    has_explicit_contexts: bool = False
    is_memory_recall_turn: bool = False
    is_global_action_req: bool = False


_EXPLICIT_APP_ACTION_PHRASES: tuple[str, ...] = (
    "sentimeta",
    "goi y nhom",
    "tim nhom",
    "tham gia nhom",
    "roi nhom",
    "nhom cua toi",
    "an bai viet",
    "dang bai",
    "xoa bai",
    "chinh sua bai",
    "tat thong bao",
    "bat thong bao",
    "thong bao chua doc",
    "danh dau da doc",
    "doi anh dai dien",
    "doi avatar",
    "doi mat khau",
    "chinh sua ho so",
    "chinh sua trang ca nhan",
    "quyen rieng tu",
    "cai dat rieng tu",
    "lich su kiem duyet",
    "gui khieu nai",
    "thu hoi tin nhan",
    "tao nhom chat",
    "goi video",
    "loi moi ket ban",
    "danh sach ban be",
    "chan nguoi dung",
    "goi y ban be",
)

MENTAL_HEALTH_RAG_TIERS: tuple[str, ...] = (
    "actionable_worksheet",
    "clinical_reference",
    "background_theory",
)
APP_GUIDE_RAG_TIERS: tuple[str, ...] = ("system_guide",)


def is_system_guide_only_tiers(allowed_tiers: tuple[str, ...] | None) -> bool:
    return bool(allowed_tiers) and {t.lower() for t in allowed_tiers} == {
        "system_guide"
    }


def is_mental_health_only_tiers(allowed_tiers: tuple[str, ...] | None) -> bool:
    return bool(allowed_tiers) and "system_guide" not in {
        t.lower() for t in allowed_tiers
    }


def has_explicit_app_intent(
    message: str,
    matched_domains: tuple[str, ...],
    *,
    has_howto_nav: bool = False,
    is_global_action_req: bool = False,
) -> bool:
    """Return True only when the query expresses concrete app/feature/tool intent.

    Intentionally avoids triggering on bare social words like 'bạn bè' or 'chia sẻ'
    inside emotional venting (e.g., 'mình không có bạn bè nào để chia sẻ nỗi buồn').
    """
    if has_howto_nav or is_global_action_req:
        return True
    norm = normalize_for_guard(message)
    if not norm:
        return False
    if any(phrase in norm for phrase in _EXPLICIT_APP_ACTION_PHRASES):
        return True
    padded_norm = f" {norm} "
    has_sys_domain = bool(set(matched_domains) & SYSTEM_FEATURE_DOMAINS)
    if has_sys_domain and (
        any(ind in norm for ind in _HOWTO_INDICATORS)
        or any(f" {ind} " in padded_norm for ind in _DATA_RETRIEVAL_INDICATORS)
        or any(norm.startswith(p) for p in _VIEW_DATA_PREFIXES)
    ):
        return True
    return False


def is_user_data_query(
    message: str,
    matched_domains: tuple[str, ...],
    *,
    is_global_action_req: bool = False,
) -> bool:
    if is_global_action_req:
        return True
    norm = normalize_for_guard(message)
    if not norm:
        return False
    padded_norm = f" {norm} "
    has_retrieval_phrasing = any(
        f" {ind} " in padded_norm for ind in _DATA_RETRIEVAL_INDICATORS
    ) or any(norm.startswith(p) for p in _VIEW_DATA_PREFIXES)
    if not has_retrieval_phrasing:
        return False
    return bool(
        set(matched_domains)
        & (SYSTEM_FEATURE_DOMAINS | {"emotion", "mental_health"})
    )


def resolve_turn_mode(signals: TurnModeSignals) -> TurnMode:
    """Deterministic priority cascade mapping turn signals to a single canonical TurnMode."""
    has_sys_domain = bool(set(signals.matched_domains) & SYSTEM_FEATURE_DOMAINS)
    has_mental_health_signal = bool(
        signals.distress_level in {"acute_pfa", "mild_cbt"}
        or signals.has_in_chat_distress
        or signals.has_active_session_anchor
        or ("mental_health" in signals.matched_domains)
        or ("emotion" in signals.matched_domains and not has_sys_domain)
    )
    app_intent = has_explicit_app_intent(
        signals.message,
        signals.matched_domains,
        has_howto_nav=signals.has_howto_nav,
        is_global_action_req=signals.is_global_action_req,
    )
    data_query = is_user_data_query(
        signals.message,
        signals.matched_domains,
        is_global_action_req=signals.is_global_action_req,
    )

    # 1. Acute PFA always wins over app signals for clinical safety
    if signals.distress_level == "acute_pfa":
        return TurnMode.MENTAL_HEALTH_PFA

    # 2. Mixed emotional + explicit app/tool intent (e.g., "stress quá, gợi ý nhóm thiền")
    if has_mental_health_signal and app_intent:
        return TurnMode.MIXED_SUPPORT_APP

    # 3. Live user data retrieval or global account action
    if data_query and signals.scope_in_scope:
        return TurnMode.USER_DATA

    # 4. Mental health / emotional support (mild CBT, venting, or active session anchor)
    if has_mental_health_signal:
        return TurnMode.MENTAL_HEALTH_CBT

    # 5. Sentimeta app guide / in-domain unknown feature inquiry / explicit contexts / memory recall
    if (
        signals.scope_in_scope
        or signals.scope_state == "in_domain_unknown"
        or signals.has_explicit_contexts
        or signals.is_memory_recall_turn
        or signals.has_howto_nav
    ):
        return TurnMode.APP_GUIDE

    # 6. General fallback (RAG=[], tools=[]): LLM distinguishes everyday conversation vs off-topic tasks
    return TurnMode.GENERAL_FALLBACK


def rag_tier_filter_for_mode(mode: TurnMode) -> tuple[str, ...] | None:
    """Return allowed RAG doc tiers for a TurnMode.

    - Empty tuple `()`: skip RAG completely.
    - Non-empty tuple: keep only docs matching one of these tiers.
    - `None`: allow all tiers (used for mixed support + app turns).
    """
    if mode in {
        TurnMode.CRISIS,
        TurnMode.POLICY_RESTRICTED,
        TurnMode.NAVIGATION,
        TurnMode.GENERAL_FALLBACK,
    }:
        return ()
    if mode in {TurnMode.MENTAL_HEALTH_PFA, TurnMode.MENTAL_HEALTH_CBT}:
        return MENTAL_HEALTH_RAG_TIERS
    if mode in {TurnMode.APP_GUIDE, TurnMode.USER_DATA}:
        return APP_GUIDE_RAG_TIERS
    return None


def mode_prompt_directive(mode: TurnMode) -> str | None:
    """Return a concise turn-mode directive for PromptBuilder when needed."""
    if mode == TurnMode.GENERAL_FALLBACK:
        vn_now = datetime.now(timezone(timedelta(hours=7)))
        weekdays_vi = (
            "Thứ Hai",
            "Thứ Ba",
            "Thứ Tư",
            "Thứ Năm",
            "Thứ Sáu",
            "Thứ Bảy",
            "Chủ Nhật",
        )
        now_label = f"{weekdays_vi[vn_now.weekday()]}, ngày {vn_now.strftime('%d/%m/%Y')}, {vn_now.strftime('%H:%M')} (giờ Việt Nam)"
        return (
            f"TURN ROUTING (GENERAL_FALLBACK): Thời gian hiện tại là {now_label}.\n"
            "- Nếu người dùng đang trò chuyện đời thường, kể chuyện cuộc sống, hỏi ngày giờ hiện tại hoặc câu xã giao/vui nhẹ nhàng (bất kể độ dài): "
            "hãy đáp lại ấm áp, tự nhiên trong 1-2 câu (xưng 'mình - bạn') và nhẹ nhàng mở lời lắng nghe.\n"
            "- Nếu người dùng yêu cầu thực hiện tác vụ chuyên môn hoặc tra cứu dữ liệu/kiến thức thực tế ngoài Sentimeta "
            "(viết code, giải bài tập phức tạp, tư vấn tài chính/pháp lý/đầu tư, thời tiết/tin tức/tỷ số thời gian thực, dịch tài liệu...): "
            "không thực hiện tác vụ đó; từ chối khéo trong 1-2 câu và hướng nhẹ về Sentimeta hoặc chăm sóc sức khỏe tinh thần.\n"
            "- Nếu câu nói vừa nhắc chủ đề ngoài lề vừa bộc lộ cảm xúc (vd: áp lực học lập trình, lo lắng tài chính): "
            "hãy đồng cảm với cảm xúc của người dùng nhưng tuyệt đối không tư vấn chuyên môn ngoài phạm vi."
        )
    if mode == TurnMode.MIXED_SUPPORT_APP:
        return (
            "TURN ROUTING (MIXED_SUPPORT_APP): Người dùng vừa bày tỏ cảm xúc vừa cần hỗ trợ tính năng/công cụ trên Sentimeta. "
            "Hãy bắt đầu bằng ĐÚNG 1 câu đồng cảm ngắn gọn, ấm áp rồi đi thẳng vào giải đáp hoặc gọi công cụ hệ thống phù hợp; "
            "không biến câu trả lời thành bài giảng tâm lý dài dòng."
        )
    return None
