from typing import List, Dict


CATEGORY_VI_MAP = {
    "blood": "Hình ảnh có máu",
    "violence": "Hình ảnh bạo lực",
    "weapon": "Hình ảnh vũ khí",
    "sexual": "Nội dung nhạy cảm",
    "disturbing": "Nội dung gây khó chịu",
}

TEXT_VIOLATION_MSG = "Nội dung văn bản không phù hợp"


def build_violations(moderation: dict) -> List[Dict]:
    categories = set()
    max_severity = "NONE"
    max_confidence = 0.0

    # image
    for img in moderation.get("imageResults", []):
        if img.get("isViolation"):
            category = img.get("category")
            if category:
                categories.add(category)

            max_confidence = max(max_confidence, img.get("violationScore", 0))

            severity = img.get("severity", "none").upper()
            if severity == "HIGH":
                max_severity = "HIGH"
            elif severity == "MEDIUM" and max_severity != "HIGH":
                max_severity = "MEDIUM"
            elif severity == "LOW" and max_severity not in ["HIGH", "MEDIUM"]:
                max_severity = "LOW"

    # text
    text = moderation.get("textResult")
    if text and text.get("isViolation"):
        categories.add("text")
        max_confidence = max(max_confidence, text.get("violationScore", 0))

    # map sang output gọn
    return [
        {
            "category": c.upper(),
            "reason": CATEGORY_VI_MAP.get(c, TEXT_VIOLATION_MSG if c == "text" else "Nội dung không phù hợp"),
        }
        for c in categories
    ]


def build_display_message(is_violation: bool, violations: List[Dict]) -> str:
    if not is_violation:
        return "Nội dung của bạn hợp lệ."

    if not violations:
        return "Nội dung của bạn vi phạm tiêu chuẩn cộng đồng."

    reasons = [v["reason"] for v in violations]

    return "Nội dung của bạn bị ẩn do: " + ", ".join(reasons)