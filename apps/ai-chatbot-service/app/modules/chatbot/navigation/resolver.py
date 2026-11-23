from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.modules.chatbot.navigation.catalog import (
    DestinationCatalog,
    destination_catalog,
)
from app.modules.chatbot.services.guardrails_support.crisis import (
    has_in_chat_emotional_distress,
)
from app.utils.text_normalizer import normalize_for_guard

_COMMAND_PREFIXES = (
    "mo ",
    "vao ",
    "di toi ",
    "chuyen toi ",
    "chuyen den ",
    "den ",
    "xem ",
    "cho toi xem ",
    "dua toi toi ",
    "dua toi den ",
    "truy cap ",
    "open ",
    "go to ",
    "show ",
    "view ",
    "ve ",
    "quay ve ",
)

_VIEW_DATA_PREFIXES = (
    "xem ",
    "cho toi xem ",
    "show ",
    "view ",
)

READ_TOOL_BACKED_DESTINATIONS: frozenset[str] = frozenset(
    {
        "friends",
        "friends.requests",
        "friends.suggestions",
        "friends.blocked",
        "groups.my_groups",
        "groups.invites",
        "emotions",
        "notifications",
        "settings.privacy",
        "settings.moderation",
    }
)

_HOWTO_INDICATORS = (
    "lam sao",
    "lam the nao",
    "cach ",
    "huong dan",
    "o dau",
    "cho nao",
    "nhu the nao",
    "how to",
    "where",
)

_EXPLANATION_INDICATORS = (
    "tai sao",
    "vi sao",
    "sao lai",
    "nguyen nhan",
    "tai vi sao",
    "tieu chi",
    "dua tren",
    "la gi",
    "khac gi",
    "khac nhau",
    "hoat dong nhu the nao",
    "co nghia la",
    "dung de lam gi",
    "muc dich",
)

_DATA_RETRIEVAL_INDICATORS = (
    "cho toi biet",
    "cho minh biet",
    "cho em biet",
    "biet danh sach",
    "liet ke",
    "co bao nhieu",
    "ai dang",
    "nhung ai",
    "gom nhung ai",
    "gom ai",
    "co nhung ai",
    "co ai dang",
    "tell me",
    "list my",
    "list all",
    "how many",
    "who are",
    "who is",
)

_ADMIN_KEYWORDS = (
    "admin",
    "quan tri vien",
    "quan tri he thong",
    "bang dieu khien admin",
    "dashboard admin",
)

_SEARCH_CONVERSATIONAL_SUFFIXES = re.compile(
    r"\s+(?:nhe|nha|di|voi|dum|gium|giup|a|nhe ban|nha ban|nhe bot|nha bot|voi a|xem)\s*$",
    re.IGNORECASE,
)
_PUNCTUATION_AND_QUOTES = re.compile(
    r"^[?.,!:;\"'\u201c\u201d\u2018\u2019\s]+|[?.,!:;\"'\u201c\u201d\u2018\u2019\s]+$"
)


@dataclass(frozen=True, slots=True)
class NavMatch:
    destination_id: str
    label_vi: str
    score: float
    params: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class NavDecision:
    path: str  # "command" | "howto" | "clarify" | "none"
    matches: list[NavMatch] = field(default_factory=list)
    suggested_reply: str | None = None


class NavResolver:
    """Pure, deterministic, zero-I/O navigation intent resolver."""

    def __init__(self, catalog: DestinationCatalog | None = None) -> None:
        self._catalog = catalog or destination_catalog

    def resolve(self, text: str, ai_policy: str = "FULL") -> NavDecision:
        normalized = normalize_for_guard(text)
        if not normalized or len(normalized) < 2:
            return NavDecision(path="none")

        # Admin boundary check: admin screens are never offered
        if any(admin_term in normalized for admin_term in _ADMIN_KEYWORDS):
            return NavDecision(path="none")

        # Emotional distress check: emotional sharing must not be hijacked by UI navigation
        if has_in_chat_emotional_distress(text):
            return NavDecision(path="none")

        # Feature inquiry check: "có chức năng... không?" is an app feature question, not navigation
        if re.search(
            r"\b(co|chuc nang|tinh nang|ho tro)\b.*\b(khong|chua)\b", normalized
        ):
            return NavDecision(path="none")

        is_howto = any(indicator in normalized for indicator in _HOWTO_INDICATORS)

        # Explanation / Why inquiry check: "tại sao...", "vì sao..." are diagnostic questions
        if (not is_howto) and any(
            indicator in normalized for indicator in _EXPLANATION_INDICATORS
        ):
            return NavDecision(path="none")

        # 1. Check for search intent with query extraction
        search_match = self._extract_search_intent(
            normalized, text, ai_policy=ai_policy
        )
        if search_match:
            return NavDecision(
                path="command",
                matches=[search_match],
                suggested_reply="Mình mở trang tìm kiếm cho bạn với từ khóa này nhé:",
            )

        # Data retrieval inquiry check: "cho tôi biết...", "liệt kê...", "có bao nhiêu..." are data queries, not navigation commands
        padded_norm = f" {normalized} "
        is_data_retrieval = (not is_howto) and any(
            f" {indicator} " in padded_norm for indicator in _DATA_RETRIEVAL_INDICATORS
        )
        if is_data_retrieval:
            return NavDecision(path="none")

        is_command = any(normalized.startswith(prefix) for prefix in _COMMAND_PREFIXES)
        is_view_data_prefix = any(
            normalized.startswith(prefix) for prefix in _VIEW_DATA_PREFIXES
        )
        is_full_policy = str(ai_policy or "").strip().upper() == "FULL"

        # 2. Score all destinations against normalized text
        matches = self._score_destinations(
            normalized,
            is_command=is_command,
            is_howto=is_howto,
            ai_policy=ai_policy,
        )
        if not matches:
            return NavDecision(path="none")

        top_match = matches[0]
        tokens = normalized.split()

        # Under FULL policy, "xem <entity backed by Read Tool>" should flow through
        # Phase 2 Read Tool (producing a Mini Card) and ride along as a howto button.
        if (
            is_full_policy
            and is_view_data_prefix
            and top_match.destination_id in READ_TOOL_BACKED_DESTINATIONS
            and top_match.score >= 0.70
        ):
            return NavDecision(
                path="howto",
                matches=[top_match],
            )

        # 3. Disambiguate path
        if is_command and top_match.score >= 0.70:
            return NavDecision(
                path="command",
                matches=[top_match],
                suggested_reply=(
                    f"Mình đã tìm thấy màn hình {top_match.label_vi} cho bạn. "
                    "Bạn bấm vào nút bên dưới để chuyển nhanh nhé:"
                ),
            )

        if is_howto and top_match.score >= 0.50:
            # How-to intent: keep top 1 or 2 matches for RAG attachment
            return NavDecision(
                path="howto",
                matches=matches[:2],
            )

        # High confidence exact/strong match defaults to command if score >= 0.90
        if top_match.score >= 0.90:
            return NavDecision(
                path="command",
                matches=[top_match],
                suggested_reply=(
                    f"Bạn có thể truy cập nhanh vào {top_match.label_vi} bằng nút bên dưới:"
                ),
            )

        # If 2-3 destinations match closely (score >= 0.60)
        close_matches = [m for m in matches if m.score >= 0.60][:3]
        if (is_command or len(tokens) <= 5) and len(close_matches) >= 2:
            return NavDecision(
                path="clarify",
                matches=close_matches,
                suggested_reply="Bạn muốn chuyển đến màn hình nào dưới đây?",
            )

        if top_match.score >= 0.75:
            return NavDecision(
                path="command",
                matches=[top_match],
                suggested_reply=(
                    f"Mình tìm thấy màn hình {top_match.label_vi}. "
                    "Bạn bấm nút bên dưới để truy cập nhé:"
                ),
            )

        return NavDecision(path="none")

    def _extract_search_intent(
        self, normalized: str, original_text: str, ai_policy: str = "FULL"
    ) -> NavMatch | None:
        # If the user is asking where to find something (howto), don't treat it as a search query
        if any(h in normalized for h in _HOWTO_INDICATORS):
            return None

        # e.g. "tim kiem nhom yoga", "tim ban nam", "tim bai viet ve cam xuc", "tim cho toi nhom yoga nhe"
        search_pattern = re.compile(
            r"^(?:tim kiem|tim|tra cuu)\s+(?:cho toi|giup toi|gium toi|ho toi)?\s*(bai viet|nguoi dung|ban be|ban|nhom|group)?\s*(?:ve|ten)?\s*(.+)$",
            re.IGNORECASE,
        )
        match = search_pattern.match(normalized)
        if not match:
            return None

        target_type_raw = match.group(1) or ""
        raw_query_norm = match.group(2).strip()

        # Sanitize conversational suffixes ("nhé", "đi", "với", "ạ") and surrounding quotes
        clean_query = _SEARCH_CONVERSATIONAL_SUFFIXES.sub("", raw_query_norm).strip()
        clean_query = _PUNCTUATION_AND_QUOTES.sub("", clean_query).strip()

        # If user explicitly specified quotes in original text (e.g. 'tìm bài viết về "Sức khỏe tinh thần" nhé')
        quoted_match = re.search(
            r"[\"'\u201c\u2018]([^\u201d\u2019\"']{2,100})[\"'\u201d\u2019]",
            original_text,
        )
        if quoted_match:
            safe_query = quoted_match.group(1).strip()
        else:
            # Try to preserve exact casing from original_text if unaccented word matches
            match_in_orig = re.search(
                r"\b" + re.escape(clean_query) + r"\b", original_text, re.IGNORECASE
            )
            if match_in_orig:
                safe_query = match_in_orig.group(0).strip()
            else:
                safe_query = clean_query[:100].strip()

        # If query is too short or empty
        if len(safe_query) < 2:
            return None

        # Don't trigger search if user is asking to find friends/groups pages
        if safe_query in {"ban be", "nhom", "ban", "moi"}:
            return None

        search_type = "posts"
        if target_type_raw in {"nguoi dung", "ban be", "ban"}:
            search_type = "users"
        elif target_type_raw in {"nhom", "group"}:
            search_type = "groups"

        search_entry = self._catalog.get("search")
        label = search_entry.label_vi if search_entry else "Tìm kiếm"

        return NavMatch(
            destination_id="search",
            label_vi=f'{label}: "{safe_query}"',
            score=0.95,
            params={"q": safe_query, "type": search_type},
        )

    def score_destinations(
        self, text: str, ai_policy: str = "FULL"
    ) -> list[NavMatch]:
        """Score matching non-admin destinations without command/data-retrieval early exits."""
        normalized = normalize_for_guard(text)
        if not normalized or len(normalized) < 2:
            return []
        if any(admin_term in normalized for admin_term in _ADMIN_KEYWORDS):
            return []
        return self._score_destinations(
            normalized,
            is_command=True,
            is_howto=False,
            ai_policy=ai_policy,
        )

    def _score_destinations(
        self,
        normalized: str,
        is_command: bool = False,
        is_howto: bool = False,
        ai_policy: str = "FULL",
    ) -> list[NavMatch]:
        scored: list[NavMatch] = []
        user_word_list = normalized.split()
        user_tokens = set(user_word_list)
        num_user_tokens = max(len(user_word_list), 1)

        for entry in self._catalog.all_destinations():
            best_score = 0.0

            for synonym in entry.synonyms:
                norm_syn = normalize_for_guard(synonym)
                if not norm_syn:
                    continue

                syn_tokens = norm_syn.split()
                syn_token_set = set(syn_tokens)
                coverage = len(syn_tokens) / num_user_tokens

                # Exact synonym phrase match in text
                if norm_syn == normalized:
                    score = 1.0
                elif f" {norm_syn} " in f" {normalized} ":
                    # Substring word-boundary match: longer matches are more specific
                    if len(syn_tokens) >= 2:
                        # If not command and not howto, require at least 35% word coverage to avoid hijacking long sentences
                        if is_command or is_howto or coverage >= 0.35:
                            score = 0.82 + (0.04 * min(len(syn_tokens), 4))
                        else:
                            score = 0.40
                    elif is_command or is_howto or len(user_tokens) <= 2 or coverage >= 0.45:
                        score = 0.75
                    else:
                        score = 0.40
                elif syn_token_set.issubset(user_tokens):
                    # All synonym words present
                    ratio = len(syn_tokens) / num_user_tokens
                    if is_command or is_howto or ratio >= 0.35:
                        score = 0.70 + (0.20 * ratio)
                    else:
                        score = 0.40
                else:
                    # Token overlap
                    overlap = len(syn_token_set.intersection(user_tokens))
                    if overlap >= 2:
                        if is_command or is_howto or (overlap / num_user_tokens) >= 0.35:
                            score = 0.50 + (0.15 * (overlap / len(syn_tokens)))
                        else:
                            score = 0.40
                    elif (
                        overlap == 1
                        and len(syn_tokens) == 1
                        and len(norm_syn) >= 4
                        and (is_command or len(user_tokens) <= 2)
                    ):
                        score = 0.65
                    else:
                        score = 0.0

                if score > best_score:
                    best_score = score

            if best_score >= 0.50:
                scored.append(
                    NavMatch(
                        destination_id=entry.id,
                        label_vi=entry.label_vi,
                        score=round(best_score, 3),
                    )
                )

        scored.sort(key=lambda x: x.score, reverse=True)
        return scored


nav_resolver = NavResolver()
