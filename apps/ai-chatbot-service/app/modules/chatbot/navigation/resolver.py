from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.modules.chatbot.navigation.catalog import DestinationCatalog, destination_catalog
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

    def resolve(self, text: str) -> NavDecision:
        normalized = normalize_for_guard(text)
        if not normalized or len(normalized) < 2:
            return NavDecision(path="none")

        # Admin boundary check: admin screens are never offered
        if any(admin_term in normalized for admin_term in _ADMIN_KEYWORDS):
            return NavDecision(path="none")

        # Feature inquiry check: "có chức năng... không?" is an app feature question, not navigation
        if re.search(r"\b(co|chuc nang|tinh nang|ho tro)\b.*\b(khong|chua)\b", normalized):
            return NavDecision(path="none")

        # 1. Check for search intent with query extraction
        search_match = self._extract_search_intent(normalized, text)
        if search_match:
            return NavDecision(
                path="command",
                matches=[search_match],
                suggested_reply="Mình mở trang tìm kiếm cho bạn với từ khóa này nhé:",
            )

        is_command = any(normalized.startswith(prefix) for prefix in _COMMAND_PREFIXES)
        is_howto = any(indicator in normalized for indicator in _HOWTO_INDICATORS)

        # 2. Score all destinations against normalized text
        matches = self._score_destinations(normalized, is_command=is_command, is_howto=is_howto)
        if not matches:
            return NavDecision(path="none")

        top_match = matches[0]

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
        if len(close_matches) >= 2:
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

    def _extract_search_intent(self, normalized: str, original_text: str) -> NavMatch | None:
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
        quoted_match = re.search(r"[\"'\u201c\u2018]([^\u201d\u2019\"']{2,100})[\"'\u201d\u2019]", original_text)
        if quoted_match:
            safe_query = quoted_match.group(1).strip()
        else:
            # Try to preserve exact casing from original_text if unaccented word matches
            match_in_orig = re.search(r"\b" + re.escape(clean_query) + r"\b", original_text, re.IGNORECASE)
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
            label_vi=f"{label}: \"{safe_query}\"",
            score=0.95,
            params={"q": safe_query, "type": search_type},
        )

    def _score_destinations(
        self,
        normalized: str,
        is_command: bool = False,
        is_howto: bool = False,
    ) -> list[NavMatch]:
        scored: list[NavMatch] = []
        user_tokens = set(normalized.split())

        for entry in self._catalog.all_destinations():
            best_score = 0.0

            for synonym in entry.synonyms:
                norm_syn = normalize_for_guard(synonym)
                if not norm_syn:
                    continue

                syn_tokens = norm_syn.split()
                syn_token_set = set(syn_tokens)

                # Exact synonym phrase match in text
                if norm_syn == normalized:
                    score = 1.0
                elif f" {norm_syn} " in f" {normalized} ":
                    # Substring word-boundary match: longer matches are more specific
                    if len(syn_tokens) >= 2:
                        score = 0.82 + (0.04 * min(len(syn_tokens), 4))
                    elif is_command or is_howto or len(user_tokens) <= 2:
                        score = 0.75
                    else:
                        score = 0.40
                elif syn_token_set.issubset(user_tokens):
                    # All synonym words present
                    ratio = len(syn_tokens) / max(len(user_tokens), 1)
                    score = 0.70 + (0.20 * ratio)
                else:
                    # Token overlap
                    overlap = len(syn_token_set.intersection(user_tokens))
                    if overlap >= 2:
                        score = 0.50 + (0.15 * (overlap / len(syn_tokens)))
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
