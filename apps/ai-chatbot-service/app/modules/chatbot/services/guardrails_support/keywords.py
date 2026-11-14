from __future__ import annotations

import re
from dataclasses import dataclass


CRISIS_EXPLICIT_KEYWORDS: frozenset[str] = frozenset(
    {
        # Direct suicide intent
        "tu tu",
        "tu sat",
        "ket thuc cuoc doi",
        "ket thuc tat ca",
        "khong muon song nua",
        "khong muon tiep tuc song",
        "muon chet",
        "muon tu tu",
        "muon tu sat",
        "chon chet",
        "uong thuoc tu tu",
        "nhat dao tu tu",
        "nhay lau tu tu",
        "suicide",
        "want to die",
        "kill myself",
        "end my life",
        "take my own life",
        "no reason to live",
        # Self-harm
        "cat tay",
        "tu lam dau ban than",
        "tu hanh ha ban than",
        "self harm",
        "cut myself",
        "hurt myself",
    }
)

CRISIS_SOFT_KEYWORDS: frozenset[str] = frozenset(
    {
        # High-level hopelessness
        "khong con ly do de song",
        "song de lam gi",
        "cuoc song vo nghia",
        "chang co gi de song",
        "met moi cuoc doi",
        "cuoc doi chan qua",
        "khong biet phai lam gi nua",
        "khong con ai de noi chuyen",
        "cam thay co don qua",
        "cam thay tro nen vo dung",
        "life is meaningless",
        "nobody cares",
        "i give up on life",
        "can't go on",
        "don't want to be here anymore",
    }
)

IN_CHAT_DISTRESS_KEYWORDS: tuple[str, ...] = (
    "mat ngu",
    "khong ngu duoc",
    "ap luc",
    "met moi",
    "chan nan",
    "co don",
    "tu ti",
    "kem coi",
    "vo dung",
    "cang cung",
    "kho tho",
    "overthinking",
    "suy nghi nhieu",
    "kiet suc",
    "burnout",
    "buon",
    "hoang loan",
    "lo au",
    "bat an",
)

_IN_CHAT_DISTRESS_REGEX = re.compile(
    "|".join(
        rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in IN_CHAT_DISTRESS_KEYWORDS
    ),
    re.IGNORECASE,
)

_CRISIS_EXPLICIT_REGEX = re.compile(
    "|".join(
        rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in CRISIS_EXPLICIT_KEYWORDS
    ),
    re.IGNORECASE,
)
_CRISIS_SOFT_REGEX = re.compile(
    "|".join(rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in CRISIS_SOFT_KEYWORDS),
    re.IGNORECASE,
)


@dataclass(frozen=True)
class DomainKeywordGroup:
    domain: str
    keywords: set[str]


DOMAIN_KEYWORD_GROUPS: tuple[DomainKeywordGroup, ...] = (
    DomainKeywordGroup(
        "system",
        {
            "sentimeta",
            "se121",
            "he thong",
            "ung dung",
            "tinh nang",
            "mang xa hoi",
            "assistant",
            "chatbot",
        },
    ),
    DomainKeywordGroup(
        "chat",
        {
            "chat",
            "tin nhan",
            "nhan tin",
            "inbox",
            "conversation",
            "message",
            "messages",
            "dm",
        },
    ),
    DomainKeywordGroup(
        "post",
        {
            "bai viet",
            "bai dang",
            "dang bai",
            "feed",
            "newfeed",
            "post",
            "posts",
            "caption",
        },
    ),
    DomainKeywordGroup(
        "group",
        {
            "group",
            "nhom",
            "cong dong",
            "tham gia nhom",
            "nhom kin",
        },
    ),
    DomainKeywordGroup(
        "search",
        {
            "search",
            "tim",
            "tim kiem",
            "tra cuu",
            "lookup",
            "find",
            "find posts",
        },
    ),
    DomainKeywordGroup(
        "user_social",
        {
            "user",
            "tai khoan",
            "profile",
            "ho so",
            "ban be",
            "ket ban",
            "goi y ban be",
            "recommendation",
            "friend",
        },
    ),
    DomainKeywordGroup(
        "privacy",
        {
            "quyen rieng tu",
            "chinh sach rieng tu",
            "chinh sach bao mat",
            "bao mat",
            "du lieu ca nhan",
            "thong tin ca nhan",
            "block",
            "chan nguoi dung",
            "privacy",
            "privacy policy",
            "privacy settings",
            "data policy",
            "personal data",
        },
    ),
    DomainKeywordGroup(
        "notification",
        {
            "thong bao",
            "notification",
            "notifications",
        },
    ),
    DomainKeywordGroup(
        "emotion",
        {
            "cam xuc",
            "phan tich cam xuc",
            "sentiment",
            "emotion",
            "buon",
            "lo au",
            "bat an",
            "met moi",
            "chan nan",
            "co don",
            "tam trang",
        },
    ),
    DomainKeywordGroup(
        "memory",
        {
            "ban con nho",
            "nho noi dung truoc do",
            "tom tat cuoc tro chuyen",
            "conversation history",
            "chat history",
            "nho gi khong",
        },
    ),
    DomainKeywordGroup(
        "mental_health",
        {
            "tam ly",
            "tram cam",
            "lo au",
            "cang thang",
            "stress",
            "thu gian",
            "chua lanh",
            "so cuu",
            "suc khoe tinh than",
            "tri lieu",
            "cbt",
            "tho",
            "khung hoang",
            "hoang loan",
            "mat ngu",
            "khong ngu duoc",
            "ap luc",
            "met moi",
            "chan nan",
            "co don",
            "tu ti",
            "kem coi",
            "vo dung",
            "cang cung",
            "kho tho",
            "overthinking",
            "suy nghi nhieu",
            "kiet suc",
            "burnout",
            "bat an",
        },
    ),
    DomainKeywordGroup(
        "settings_support",
        {
            "cai dat",
            "settings",
            "doi mat khau",
            "change password",
            "tro giup",
            "support",
            "bao cao",
            "report",
            "phan hoi",
            "feedback",
            "help",
            "help center",
            "khang nghi",
        },
    ),
    DomainKeywordGroup(
        "call",
        {
            "cuoc goi",
            "goi dien",
            "call",
            "calls",
            "goi video",
            "goi audio",
            "video call",
            "voice call",
        },
    ),
    DomainKeywordGroup(
        "share",
        {
            "chia se",
            "share",
            "shares",
            "dang lai",
            "repost",
        },
    ),
    DomainKeywordGroup(
        "auth",
        {
            "dang nhap",
            "login",
            "signin",
            "dang ky",
            "register",
            "signup",
            "quen mat khau",
            "forgot password",
            "password",
            "mat khau",
        },
    ),
)

FOLLOW_UP_REFERENCE_KEYWORDS = {
    "chuc nang tren",
    "tinh nang tren",
    "cai tren",
    "cai do",
    "cai nay",
    "no",
    "no do",
    "nhu tren",
    "nhu vay",
    "phia tren",
    "cai kia",
    "phan tren",
    "phan do",
    "phan nay",
    "muc tren",
    "muc do",
    "muc nay",
    "chuc nang do",
    "tinh nang do",
    "chuc nang nay",
    "tinh nang nay",
    "phim do",
    "nut do",
    "cho do",
    "do thi sao",
    "do la sao",
    "y tren",
    "y do",
    "van de do",
    "truong hop do",
    "cau do",
    "tiep theo",
    "sau do",
    "ke tiep",
    "roi sao nua",
    "sao nua",
    "sau nua",
    "tiep nua",
    "huong dan tiep",
    "cach dung",
    "cach su dung",
    "su dung nhu nao",
    "dung nhu nao",
    "lam nhu nao voi no",
    "lam sao de dung",
    "chi tiet hon",
    "giai thich them",
    "noi ro hon",
    "cu the hon",
    "cho vi du",
    "vi du cu the",
    "tom tat lai",
    "how to use",
    "how does it work",
    "can you explain more",
    "explain more",
    "more details",
    "in detail",
    "step by step",
    "what next",
    "then what",
    "how about that",
    "about that",
    "that one",
    "this one",
    "that part",
    "this part",
    "that section",
    "this section",
    "giai thich them ve no",
    "cho vi du cu the",
    "buoc tiep theo",
    "cach dung cai do",
    "truoc do",
    "cai truoc do",
    "y truoc do",
    "van de truoc do",
}

STRONG_REFERENCE_KEYWORDS = {
    "chuc nang tren",
    "phan do",
    "muc nay",
    "that section",
    "this section",
    "that feature",
    "this feature",
}

GREETINGS = {
    "hi",
    "hello",
    "hey",
    "xin chao",
    "chao",
}

FEATURE_QUERY_KEYWORDS = {
    "co chuc nang",
    "co ho tro",
    "ho tro khong",
    "co khong",
    "duoc khong",
    "hien tai",
    "tinh nang",
    "feature",
    "support",
    "available",
    "co the",
    "co cho phep",
}

PROFANITY_KEYWORDS = {
    "dit",
    "dm",
    "dmm",
    "vl",
    "vcl",
    "cc",
    "lon",
    "cac",
    "me may",
    "bo may",
    "deo",
    "clm",
}

COMMUNITY_UNSAFE_KEYWORDS = {
    "khung bo",
    "danh bom",
    "giet nguoi",
    "hiep dam",
    "au dam tre em",
    "child porn",
    "terrorist",
    "bomb",
    "kill someone",
}

PROFANITY_REGEX = re.compile(
    "|".join(rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in PROFANITY_KEYWORDS),
    re.IGNORECASE,
)
UNSAFE_REGEX = re.compile(
    "|".join(
        rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in COMMUNITY_UNSAFE_KEYWORDS
    ),
    re.IGNORECASE,
)
