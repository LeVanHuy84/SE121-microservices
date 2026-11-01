from typing import List, Dict


CATEGORY_VI_MAP = {
    "graphic_violence": "Hình ảnh bạo lực đẫm máu",
    "violence": "Nội dung bạo lực / gây sợ hãi",
    "blood": "Hình ảnh máu me / thương tích",
    "weapon": "Vũ khí nguy hiểm",
    "weapon_threat": "Hình ảnh vũ khí nguy hiểm / đe dọa bạo lực",
    "nsfw_adult": "Nội dung người lớn / đồi trụy",
    "sexual": "Nội dung khiêu dâm / người lớn",
    "illegal_porn": "Khiêu dâm đồi trụy vi phạm pháp luật",
    "self_harm": "Nội dung tự hại / tự tử",
    "emotional_crisis": "Khủng hoảng tâm lý / bế tắc cảm xúc",
    "hate_speech": "Ngôn từ thù ghét / công kích",
    "harassment": "Hành vi quấy rối",
    "profanity_venting": "Ngôn từ thô mộc xả stress",
}


def build_violations(moderation: dict) -> List[Dict]:
    categories_map = {}
    custom_reason = moderation.get("reason")

    # 1. Flagged categories (VLM & PhoBERT Moderation Pipeline)
    flagged = moderation.get("flaggedCategories", [])
    for c in flagged:
        c_lower = str(c).lower().replace("-", "_")
        reason = custom_reason if custom_reason else CATEGORY_VI_MAP.get(c_lower, "Nội dung vi phạm tiêu chuẩn cộng đồng")
        categories_map[str(c).upper().replace("-", "_")] = reason

    # 2. Fallback if violation detected but no flagged categories listed
    if not categories_map and moderation.get("isViolation"):
        label = moderation.get("label", "VIOLATION")
        label_key = str(label).lower().replace("-", "_")
        reason = custom_reason if custom_reason else CATEGORY_VI_MAP.get(label_key, "Nội dung vi phạm tiêu chuẩn cộng đồng")
        categories_map[str(label).upper().replace("-", "_")] = reason

    return [
        {"category": cat, "reason": reason}
        for cat, reason in categories_map.items()
    ]


def build_display_message(
    is_violation: bool,
    violations: List[Dict],
    action: str = "ALLOW",
    mental_health_support: bool = False,
    label: str = ""
) -> str:
    if action == "ALLOW" and not is_violation:
        return ""

    # Đặc biệt cho SELF_HARM: Ẩn bài nhưng thông báo nhân văn hỗ trợ y tế khẩn
    if label == "SELF_HARM" or (action == "HARD_BLOCK" and mental_health_support):
        return "Nội dung của bạn đã tạm ẩn để bảo đảm an toàn cộng đồng. Nếu bạn đang trải qua giai đoạn khó khăn hoặc cần trợ giúp tâm lý khẩn cấp, chúng tôi luôn ở đây để hỗ trợ bạn."

    reasons = [v["reason"] for v in violations if "reason" in v]
    reason_str = (": " + ", ".join(reasons)) if reasons else ""

    if action == "HARD_BLOCK":
        return f"Nội dung của bạn đã bị ẩn do vi phạm quy chuẩn cộng đồng{reason_str}."

    if action == "ALLOW_WITH_WARNING":
        return f"Nội dung của bạn đã được đăng, tuy nhiên có lưu ý về quy chuẩn{reason_str}."

    if action == "ALLOW_WITH_SUPPORT":
        return "Nội dung của bạn đã được đăng. Nếu bạn đang cảm thấy căng thẳng hoặc cần chia sẻ, chúng tôi luôn ở đây để hỗ trợ bạn."

    if is_violation or violations:
        return f"Nội dung của bạn có dấu hiệu vi phạm quy chuẩn cộng đồng{reason_str}."

    return ""
