# app/modules/analysis/services/ml_models/vlm/vlm_analyzer.py

"""
Unified Multimodal VLM Analyzer Module
- Single-pass Multimodal Inference via Groq LPUs API / OpenAI Compatible Endpoint
- 7 Ekman Emotion Classification (Multi-Label & Re-normalized Sum = 1.0)
- Dynamic Secondary Emotion Thresholding matching PhoBERT (max(0.10, P_max * 0.45))
- Multimodal Sarcasm & Conflict Detection
- Integrated Content Moderation (NSFW, Graphic Violence, Self-harm Signals)
- Native Multi-Image Array Support
- Strictly uses VLM_API_KEY, VLM_BASE_URL, VLM_MODEL_NAME environment variables
"""

import os
import sys
import json
import base64
import time
import logging
from typing import List, Dict, Any, Optional
import numpy as np
import requests
from pydantic import BaseModel, Field

from app.core.settings import settings

logger = logging.getLogger(__name__)

# Ensure UTF-8 console output
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

VALID_EMOTIONS = ["joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral"]


# ============================================================================
# 1. SCHEMAS
# ============================================================================

class EmotionScores(BaseModel):
    joy: float = Field(default=0.0, ge=0.0, le=1.0)
    sadness: float = Field(default=0.0, ge=0.0, le=1.0)
    anger: float = Field(default=0.0, ge=0.0, le=1.0)
    fear: float = Field(default=0.0, ge=0.0, le=1.0)
    disgust: float = Field(default=0.0, ge=0.0, le=1.0)
    surprise: float = Field(default=0.0, ge=0.0, le=1.0)
    neutral: float = Field(default=0.0, ge=0.0, le=1.0)


class ContentModeration(BaseModel):
    is_flagged: bool = Field(default=False)
    flagged_categories: List[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reason: Optional[str] = Field(default="")


class VLMRawOutput(BaseModel):
    modality: str = "UNIFIED_MULTIMODAL_VLM"
    primary_emotion: str = "neutral"
    secondary_emotions: List[str] = Field(default_factory=list)
    final_confidence: float = Field(default=0.8, ge=0.0, le=1.0)
    intensity: str = "moderate"
    emotion_scores: EmotionScores
    is_sarcasm_or_conflict: bool = False
    conflict_explanation: Optional[str] = ""
    content_moderation: ContentModeration = Field(default_factory=ContentModeration)
    mental_health_risk_level: str = "none"
    suggested_action: str = "NO_ACTION"


# ============================================================================
# 3. VLM ANALYZER CLASS
# ============================================================================

class VLMAnalyzer:
    """
    Unified VLM Analyzer for Multimodal Social Media Content.
    Auto-discovers active vision models on Groq/OpenAI endpoints.
    """

    SYSTEM_PROMPT = """Bạn là Trợ lý AI Phân tích Đa phương thức Tích hợp cho Mạng Xã Hội Hỗ trợ Sức khỏe Tâm thần.
Nhiệm vụ: Phân tích bài viết đính kèm văn bản và danh sách hình ảnh.

BẮT BUỘC TRẢ VỀ JSON DUY NHẤT CHỨA CÁC TRƯỜNG DƯỚI ĐÂY:

1. content_moderation (Kiểm duyệt An toàn):
   - is_flagged (boolean): True nếu bài viết hoặc HÌNH ẢNH vi phạm chính sách an toàn.
   - flagged_categories (array): ["NSFW_ADULT", "GRAPHIC_VIOLENCE", "SELF_HARM", "HATE_SPEECH", "HARASSMENT"].
     * NSFW_ADULT: Hình ảnh khiêu dâm, khỏa thân, ảnh 18+, hở hang quá đà.
     * GRAPHIC_VIOLENCE: Máu me, bạo lực, thương tích nặng.
     * SELF_HARM: Dấu hiệu tự hại, cắt tay, tự tử.
   - confidence (float): 0.0 -> 1.0 (Độ tin cậy của vi phạm).
   - reason (string): BẮT BUỘC mô tả chi tiết lý do vi phạm bằng tiếng Việt (Ví dụ: "Hình ảnh chứa nội dung khiêu dâm/ảnh 18+ vi phạm chính sách NSFW").

2. emotion_scores (Tập 7 nhãn Ekman: "joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral").
3. primary_emotion & secondary_emotions (các nhãn phụ có score đáng kể).
4. is_sarcasm_or_conflict & conflict_explanation (Phát hiện mâu thuẫn mỉa mai giữa Status và Ảnh).
5. mental_health_risk_level (none, weak, medium, high) & suggested_action.

ĐỊNH DẠNG JSON MẪU:
{
  "modality": "UNIFIED_MULTIMODAL_VLM",
  "primary_emotion": "sadness",
  "secondary_emotions": ["fear"],
  "final_confidence": 0.88,
  "intensity": "moderate",
  "emotion_scores": {
    "joy": 0.02,
    "sadness": 0.85,
    "anger": 0.10,
    "fear": 0.42,
    "disgust": 0.05,
    "surprise": 0.00,
    "neutral": 0.08
  },
  "is_sarcasm_or_conflict": true,
  "conflict_explanation": "Status khen ngợi nhưng ảnh u uất thể hiện mỉa mai.",
  "content_moderation": {
    "is_flagged": true,
    "flagged_categories": ["NSFW_ADULT"],
    "confidence": 0.98,
    "reason": "Hình ảnh chứa nội dung khiêu dâm 18+ vi phạm nghiêm trọng chính sách nội dung."
  },
  "mental_health_risk_level": "medium",
  "suggested_action": "TRIGGER_PROACTIVE_CHECKIN"
}
"""

    def __init__(self):
        self.api_key = settings.VLM_API_KEY
        self.base_url = settings.VLM_BASE_URL
        self.model_name = settings.VLM_MODEL_NAME
        logger.info(f"[VLMAnalyzer] Initializing with Base URL: {self.base_url}")
        
        # Auto-discover models if API key is set
        available_models = self.get_available_models()
        if available_models and self.model_name not in available_models:
            vision_models = [m for m in available_models if any(x in m.lower() for x in ['vision', 'qwen', 'gemini', 'gpt'])]
            if vision_models:
                self.model_name = vision_models[0]
                logger.info(f"[VLMAnalyzer] Auto-selected vision model: {self.model_name}")

    def get_available_models(self) -> List[str]:
        if not self.api_key:
            return []
        try:
            endpoint = f"{self.base_url.rstrip('/')}/models"
            headers = {"Authorization": f"Bearer {self.api_key}"}
            resp = requests.get(endpoint, headers=headers, timeout=5)
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                return [m["id"] for m in data]
        except Exception as e:
            logger.warning(f"[VLMAnalyzer] Model list check failed: {e}")
        return []

    def _encode_image_to_base64(self, image_path: str) -> str:
        ext = os.path.splitext(image_path)[1].lower().replace('.', '')
        mime_type = "image/png" if ext == "png" else "image/jpeg"
        with open(image_path, "rb") as img_file:
            base64_data = base64.b64encode(img_file.read()).decode("utf-8")
        return f"data:{mime_type};base64,{base64_data}"

    def reload_env(self):
        """Reload environment variables dynamically."""
        self.api_key = settings.VLM_API_KEY
        self.base_url = settings.VLM_BASE_URL
        self.model_name = settings.VLM_MODEL_NAME
        if self.api_key:
            logger.info(f"[VLMAnalyzer] Dynamic reload successful! Base URL: {self.base_url}, Model: {self.model_name}")

    def analyze_post(self, text_content: str, image_inputs: List[Any]) -> Dict[str, Any]:
        """
        Analyze multimodal post (text + image_inputs).
        image_inputs can be URLs (str) or ImageInput objects with .url or .path.
        """
        if not self.api_key:
            self.reload_env()
            
        if not self.api_key:
            raise RuntimeError("API Key not found for VLM. Please set VLM_API_KEY in .env")

        start_time = time.time()
        
        # Format image URLs
        urls = []
        for img in image_inputs:
            if isinstance(img, str):
                urls.append(img)
            elif hasattr(img, 'url') and img.url:
                urls.append(img.url)
            elif hasattr(img, 'path') and img.path and os.path.exists(img.path):
                urls.append(self._encode_image_to_base64(img.path))

        user_content = [{"type": "text", "text": f"Bài viết: \"{text_content}\"\nSố lượng hình ảnh đính kèm: {len(urls)}"}]

        for url in urls[:4]:
            if url.startswith("http://") or url.startswith("https://") or url.startswith("data:image"):
                img_url = url
            elif os.path.exists(url):
                img_url = self._encode_image_to_base64(url)
            else:
                continue
            
            user_content.append({"type": "image_url", "image_url": {"url": img_url}})

        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": user_content}
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        endpoint = f"{self.base_url.rstrip('/')}/chat/completions"
        logger.info(f"[VLMAnalyzer] Calling VLM API ({self.model_name}) at {endpoint}...")

        response = requests.post(endpoint, headers=headers, json=payload, timeout=40)
        if response.status_code != 200:
            raise RuntimeError(f"VLM API Error {response.status_code}: {response.text}")

        res_json = response.json()
        raw_content = res_json["choices"][0]["message"]["content"]
        parsed_data = json.loads(raw_content)

        # Validate with Pydantic
        raw_output = VLMRawOutput(**parsed_data)
        
        # Re-normalize emotion scores so sum == 1.0 (Matching PhoBERT final_probs sum == 1.0)
        scores_dict = raw_output.emotion_scores.model_dump()
        raw_arr = np.array([max(0.0, float(scores_dict.get(k, 0.0))) for k in VALID_EMOTIONS])
        sum_scores = np.sum(raw_arr)
        
        if sum_scores > 0:
            norm_arr = raw_arr / sum_scores
        else:
            norm_arr = np.ones(7) / 7.0

        normalized_scores = {k: round(float(v), 4) for k, v in zip(VALID_EMOTIONS, norm_arr)}
        
        # Primary emotion
        sorted_indices = np.argsort(norm_arr)[::-1]
        primary_idx = sorted_indices[0]
        primary_emotion = VALID_EMOTIONS[primary_idx]
        primary_prob = float(norm_arr[primary_idx])
        
        # Dynamic Soft Multi-label extraction (Same formula as PhoBERT: max(0.10, primary_prob * 0.45))
        dynamic_threshold = max(0.10, primary_prob * 0.45)
        secondary_emotions = [
            VALID_EMOTIONS[idx] for idx in sorted_indices[1:]
            if norm_arr[idx] >= dynamic_threshold and VALID_EMOTIONS[idx] != primary_emotion
        ]

        elapsed_time = round(time.time() - start_time, 3)

        return {
            "modality": "UNIFIED_MULTIMODAL_VLM",
            "primaryEmotion": primary_emotion,
            "secondaryEmotions": secondary_emotions,
            "finalConfidence": primary_prob,
            "intensity": raw_output.intensity,
            "emotionScores": normalized_scores,
            "isSarcasmOrConflict": raw_output.is_sarcasm_or_conflict,
            "conflictExplanation": raw_output.conflict_explanation,
            "contentModeration": raw_output.content_moderation.model_dump(),
            "mentalHealthRiskLevel": raw_output.mental_health_risk_level,
            "suggestedAction": raw_output.suggested_action,
            "latencySeconds": elapsed_time,
            "modelUsed": self.model_name
        }


# Singleton instance
vlm_analyzer = VLMAnalyzer()
