from __future__ import annotations

import re
from dataclasses import dataclass


CRISIS_EXPLICIT_KEYWORDS: frozenset[str] = frozenset(
    {
        # Direct suicide intent & method seeking
        "tu tu",
        "tu sat",
        "ket thuc cuoc doi",
        "ket thuc cuoc song",
        "khong muon song nua",
        "khong muon tiep tuc song",
        "muon chet",
        "muon tu tu",
        "muon tu sat",
        "uong thuoc tu tu",
        "nhat dao tu tu",
        "nhay lau tu tu",
        "cach chet",
        "cach nao chet",
        "chet nhe nhang",
        "chet khong dau",
        "huong dan chet",
        "huong dan tu tu",
        "huong dan tu sat",
        "cach tu tu",
        "cach tu sat",
        "phuong phap tu sat",
        "phuong phap tu tu",
        "chet di cho xong",
        "chet cho xong",
        "chet di",
        "cham dut tat ca",
        "giai thoat duy nhat",
        "nhay xuong dong song",
        "nhay song",
        "nhay cau",
        "lan can tang",
        "dung tren lan can",
        "sach no tran gian",
        "dap dau vao tuong",
        "suicide",
        "want to die",
        "kill myself",
        "end my life",
        "take my own life",
        "no reason to live",
        "how to die",
        "how to commit suicide",
        # Self-harm
        "cat tay",
        "rach co tay",
        "rach tay",
        "tu cat tay",
        "tu rach tay",
        "tu lam dau ban than",
        "tu hanh ha ban than",
        "self harm",
        "cut myself",
        "hurt myself",
        # Vietnamese teencode suicidal exit expressions
        "di dau do that xa k ve",
        "di dau do that xa khong ve",
        "di that xa k ve",
        "di that xa khong ve",
        "k mun song",
        "khong mun song",
    }
)

CRISIS_SOFT_KEYWORDS: frozenset[str] = frozenset(
    {
        # High-level hopelessness & severe existential despair (incl. Vietnamese teencode)
        "khong con ly do de song",
        "song de lam gi",
        "cuoc song vo nghia",
        "cuoc song nay vo nghia",
        "cuoc song that vo nghia",
        "chang co gi de song",
        "met moi cuoc doi",
        "chan doi",
        "di dau do that xa",
        "di that xa k ve",
        "di that xa khong ve",
        "k mun song",
        "khong mun song",
        "reset cuoc doi",
        "reset server cuoc doi",
        "life is meaningless",
        "nobody cares",
        "i give up on life",
        "can't go on",
        "don't want to be here anymore",
    }
)

ACUTE_PFA_DISTRESS_KEYWORDS: tuple[str, ...] = (
    "hoang loan",
    "kho tho",
    "tim dap nhanh",
    "kiet suc",
    "khong chiu noi nua",
    "sup do",
    "panic attack",
    "run ray",
    "ngat tho",
)

MILD_CBT_DISTRESS_KEYWORDS: tuple[str, ...] = (
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
    "overthinking",
    "suy nghi nhieu",
    "burnout",
    "buon",
    "lo au",
    "bat an",
    "cang thang",
    "that vong",
    "ton thuong",
    "be tac",
    "bat luc",
    "so hai",
    "dan vat",
    "hoang mang",
    "lac long",
    "tui than",
    "can rut",
    "lo so",
    "rot mon",
    "khong biet nen",
    "cai nhau",
)

IN_CHAT_DISTRESS_KEYWORDS: tuple[str, ...] = (
    *ACUTE_PFA_DISTRESS_KEYWORDS,
    *MILD_CBT_DISTRESS_KEYWORDS,
)

_ACUTE_PFA_DISTRESS_REGEX = re.compile(
    "|".join(
        rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in ACUTE_PFA_DISTRESS_KEYWORDS
    ),
    re.IGNORECASE,
)

_MILD_CBT_DISTRESS_REGEX = re.compile(
    "|".join(
        rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in MILD_CBT_DISTRESS_KEYWORDS
    ),
    re.IGNORECASE,
)

_IN_CHAT_DISTRESS_REGEX = re.compile(
    "|".join(
        rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in IN_CHAT_DISTRESS_KEYWORDS
    ),
    re.IGNORECASE,
)

MENTAL_HEALTH_CENTROID_ANCHORS: tuple[str, ...] = (
    "Mình đang cảm thấy áp lực, lo âu, buồn bã và muốn tìm cách thư giãn hoặc chăm sóc sức khỏe tinh thần",
    "Làm sao để vượt qua căng thẳng, mất ngủ, suy nghĩ nhiều và giữ bình tĩnh khi hoảng loạn",
    "Hướng dẫn bài tập thở chậm, thư giãn cơ và tự chăm sóc cảm xúc khi kiệt sức",
    "Chuyện gia đình, bố mẹ so sánh ép buộc, áp lực học tập công việc và tài chính khiến mình mệt mỏi khó xử",
)

SYSTEM_GUIDE_CENTROID_ANCHORS: tuple[str, ...] = (
    "Hướng dẫn sử dụng tính năng nhắn tin, gọi video, đăng bài viết và tham gia nhóm trên ứng dụng Sentimeta",
    "Cách thay đổi cài đặt quyền riêng tư, bảo mật tài khoản, tìm kiếm bạn bè và xem thông báo",
    "Làm thế nào để dùng trợ lý AI, xem phân tích cảm xúc và báo cáo nội dung vi phạm",
    "Cách đổi ảnh đại diện, ảnh bìa, cập nhật tiểu sử bio và chỉnh sửa thông tin trang cá nhân",
)

IMPLICIT_CRISIS_CENTROID_ANCHORS: tuple[str, ...] = (
    "Mình mệt mỏi quá rồi, không còn muốn cố gắng hay tiếp tục cuộc sống này nữa, mọi thứ vô nghĩa",
    "Giá như mình có thể biến mất mãi mãi để không còn phải chịu đựng nỗi đau này nữa",
    "Mình đã chuẩn bị xong hết rồi, cảm ơn mọi người vì tất cả, tạm biệt",
    "Mình muốn đăng xuất khỏi trái đất này, không còn sức để gồng thêm một ngày nào nữa",
    "Chắc mình đi ngủ một giấc thật sâu và không tỉnh lại nữa sẽ nhẹ nhõm hơn",
    "Mọi thứ kết thúc ở đây thôi, mình xin lỗi vì đã làm mọi người thất vọng",
    "Mình cảm thấy như người tàng hình, biến mất lúc này chắc cũng chẳng ai để ý",
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

_CRISIS_NEGATION_PREFIX_REGEX = re.compile(
    r"(?:^|\s)(?:"
    r"(?:khong\s+phai(?:\s+la)?|dau\s+co|dau\s+phai(?:\s+la)?|chang\s+phai(?:\s+la)?|chang\s+co|"
    r"khong\s+he(?:\s+co)?|chua\s+tung(?:\s+co)?|chua\s+bao\s+gio|khong\s+bao\s+gio|"
    r"khong\s+co\s+y\s+dinh|chua\s+co\s+y\s+dinh|khong\s+nghi\s+den|chua\s+nghi\s+den|"
    r"lam\s+gi\s+co|ai\s+lai(?:\s+di)?|do\s+not|did\s+not|will\s+not|cannot|can\s+not|don(?:'|\s+)?(?:t|toi)|never)"
    r"(?:\s+[\w]+){0,1}"
    r"|(?:khong|chua|chang)"
    r")\s*$",
    re.IGNORECASE,
)

_CRISIS_NEGATION_SUFFIX_REGEX = re.compile(
    r"^\s*(dau\b|dau\s+ma\b|gi\s+dau\b|dau\s+chu\b|dau\s+nhe\b)",
    re.IGNORECASE,
)


def is_crisis_match_negated(text: str, start: int, end: int, matched_str: str) -> bool:
    """Kiểm tra xem từ khóa crisis bắt được có bị phủ định bởi ngữ cảnh trước hoặc sau không."""
    prefix = text[max(0, start - 50) : start]
    suffix = text[end : min(len(text), end + 25)]

    # Nếu từ khóa bản thân nó đã bắt đầu bằng từ phủ định mang nghĩa khẳng định nguy cơ
    # (ví dụ: 'khong muon song nua'), chỉ coi là phủ định khi có phủ định kép cấp cao hơn
    # (ví dụ: 'khong phai la khong muon song')
    if matched_str.startswith("khong"):
        return bool(
            re.search(
                r"\b(khong\s+phai|dau\s+phai|chang\s+phai|dau\s+co)\b",
                prefix,
                re.IGNORECASE,
            )
        )

    has_prefix_neg = bool(_CRISIS_NEGATION_PREFIX_REGEX.search(prefix))
    has_suffix_neg = bool(_CRISIS_NEGATION_SUFFIX_REGEX.search(suffix))
    return has_prefix_neg or has_suffix_neg


def evaluate_explicit_crisis(normalized_text: str) -> tuple[bool, str]:
    """
    Quét từ khóa khủng hoảng trực tiếp và kiểm tra phủ định.
    Trả về (True, matched_keyword) nếu có ít nhất 1 từ khóa tự hại KHÔNG bị phủ định.
    Nếu có từ khóa nhưng tất cả đều bị phủ định, trả về (False, 'negated_crisis').
    Nếu không có từ khóa nào, trả về (False, 'no_match').
    """
    matches = list(_CRISIS_EXPLICIT_REGEX.finditer(normalized_text))
    if not matches:
        return False, "no_match"

    for m in matches:
        matched_str = m.group(0)
        if not is_crisis_match_negated(normalized_text, m.start(), m.end(), matched_str):
            return True, f"explicit_crisis:{matched_str}"

    return False, "negated_crisis"


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
            "nhom chat",
            "tao nhom chat",
            "group chat",
            "thu hoi",
            "thu hoi tin nhan",
            "xoa tin nhan",
            "cuoc goi",
            "goi video",
            "video call",
            "call",
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
            "anh dai dien",
            "avatar",
            "anh bia",
            "cover",
            "tieu su",
            "bio",
            "gioi thieu",
            "gioi thieu ban than",
            "trang ca nhan",
            "chinh sua ho so",
            "chinh sua trang ca nhan",
            "thong tin ca nhan",
            "doi anh dai dien",
            "doi avatar",
            "doi mat khau",
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
            "danh dau da doc",
            "mark all notifications",
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
            "ap luc",
            "cang thang",
            "kho ngu",
            "thu gian",
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
            "tuyet vong",
            "be tac",
            "ganh nang",
            "vo nghia",
            "ngot ngat",
            "tan bien",
            "bien mat",
            "reset cuoc doi",
            "giai thoat",
            "khong muon ton tai",
            # Crisis & suicide ideation
            "chet",
            "tu tu",
            "tu sat",
            "cach chet",
            "phuong phap tu sat",
            "nhay cau",
            "nhay song",
            "lan can",
            # Clinical, medications and medical boundary terms
            "thuoc",
            "uong thuoc",
            "thuoc ngu",
            "thuoc an than",
            "chong tram cam",
            "panadol",
            "paracetamol",
            "lieu luong",
            "ngo doc",
            "ke don",
            "don thuoc",
            "bac si",
            "kham benh",
            "chan doan",
            "benh ly",
            "tam than",
            "luong cuc",
            "bipolar",
            "tam than phan liet",
            "ao thanh",
            "hoang tuong",
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

FAREWELLS = {
    "tam biet",
    "hen gap lai",
    "gap lai sau",
    "bye",
    "goodbye",
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
    # Chửi thề rõ ràng không dấu (tránh tuyệt đối các từ đơn lẻ "cac", "lon", "cc", "cl", "bo may" gây false-positive với tiếng Việt)
    "dit",
    "dit me",
    "dm",
    "dmm",
    "dkm",
    "dcu",
    "vl",
    "vcl",
    "vkl",
    "vch",
    "vai lin",
    "vai ca dai",
    "clm",
    "cmn",
    "con cac",
    "cai lon",
    "lon me",
    "me may",
    "thang bo may",
    "bo may thach",
    "deo",
    "toang vcl",
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
ACCENTED_PROFANITY_KEYWORDS = {
    "địt",
    "đụ",
    "lồn",
    "cặc",
    "đĩ",
    "mẹ mày",
    "bố mày",
    "đéo",
}
ACCENTED_PROFANITY_REGEX = re.compile(
    "|".join(
        rf"(?<![\wàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐ]){re.escape(k)}(?![\wàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐ])"
        for k in ACCENTED_PROFANITY_KEYWORDS
    ),
    re.IGNORECASE,
)
UNSAFE_REGEX = re.compile(
    "|".join(
        rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])" for k in COMMUNITY_UNSAFE_KEYWORDS
    ),
    re.IGNORECASE,
)
