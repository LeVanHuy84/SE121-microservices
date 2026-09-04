import io
import os
import sys
import json
import base64
import time
import logging
from typing import List, Dict, Any, Optional
import numpy as np
import requests
from PIL import Image
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


class VLMBatchItemOutput(VLMRawOutput):
    id: str


class VLMBatchRawOutput(BaseModel):
    results: List[VLMBatchItemOutput]


# ============================================================================
# 2. VLM ANALYZER CLASS
# ============================================================================

class VLMAnalyzer:
    """
    Unified VLM Analyzer for Multimodal Social Media Content.
    Auto-discovers active vision models on Groq/OpenAI endpoints.
    Optimized for Token consumption, Image Compression, and Batch Execution.
    """

    SYSTEM_PROMPT = """Bạn là AI Phân tích Đa phương thức cho Mạng Xã Hội Hỗ trợ Sức khỏe Tâm thần.
Phân tích bài viết đính kèm văn bản và danh sách hình ảnh.
TRẢ VỀ JSON DUY NHẤT VỚI CÁC TRƯỜNG DƯỚI ĐÂY:
- content_moderation: {is_flagged (bool), flagged_categories (array: ["NSFW_ADULT","GRAPHIC_VIOLENCE","SELF_HARM","HATE_SPEECH","HARASSMENT"]), confidence (float 0-1), reason (string tiếng Việt nếu vi phạm)}
- emotion_scores: {joy, sadness, anger, fear, disgust, surprise, neutral} (float 0-1)
- primary_emotion (string trong 7 nhãn trên) & secondary_emotions (array strings)
- final_confidence (float 0-1), intensity ("weak"|"moderate"|"strong")
- is_sarcasm_or_conflict (bool) & conflict_explanation (string)
- mental_health_risk_level ("none"|"weak"|"medium"|"high") & suggested_action ("NO_ACTION"|"MONITOR"|"TRIGGER_PROACTIVE_CHECKIN")
"""

    BATCH_SYSTEM_PROMPT = """Bạn là AI Phân tích Đa phương thức cho Mạng Xã Hội Hỗ trợ Sức khỏe Tâm thần.
Nhiệm vụ: Phân tích danh sách gồm nhiều bài viết (mỗi bài có id, text và danh sách ảnh).
TRẢ VỀ JSON DUY NHẤT dưới dạng: {"results": [{"id": "post_id", "content_moderation": {...}, "emotion_scores": {...}, "primary_emotion": "...", "secondary_emotions": [...], "final_confidence": 0.8, "intensity": "moderate", "is_sarcasm_or_conflict": false, "conflict_explanation": "", "mental_health_risk_level": "none", "suggested_action": "NO_ACTION"}]}
Chú ý: Giữ đúng "id" cho từng bài viết tương ứng.
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

    def _compress_and_encode_image(self, image_source: Any, max_size: int = None, quality: int = None) -> str:
        """
        Compress image to max_size x max_size (JPEG) and convert to Base64 data URL.
        Reduces Vision Tokens by up to 75% while keeping high classification quality.
        """
        if max_size is None:
            max_size = settings.VLM_MAX_IMAGE_SIZE
        if quality is None:
            quality = settings.VLM_IMAGE_QUALITY

        if hasattr(image_source, 'url') and image_source.url:
            image_source = image_source.url
        elif hasattr(image_source, 'path') and image_source.path:
            image_source = image_source.path

        try:
            if isinstance(image_source, str) and (image_source.startswith("http://") or image_source.startswith("https://")):
                resp = requests.get(image_source, timeout=10)
                if resp.status_code != 200:
                    return image_source
                img = Image.open(io.BytesIO(resp.content))
            elif isinstance(image_source, str) and os.path.exists(image_source):
                img = Image.open(image_source)
            elif isinstance(image_source, str) and image_source.startswith("data:image"):
                # Already base64 data url
                header, base64_str = image_source.split(",", 1)
                img_data = base64.b64decode(base64_str)
                img = Image.open(io.BytesIO(img_data))
            else:
                return str(image_source)

            # Convert to RGB mode (in case of PNG with transparency / RGBA)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

            # Resize while preserving aspect ratio
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            # Save to JPEG bytes buffer
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True)
            encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
            return f"data:image/jpeg;base64,{encoded}"
        except Exception as e:
            logger.warning(f"[VLMAnalyzer] Image compression failed: {e}. Falling back to raw URL/Path.")
            return str(image_source)

    def reload_env(self):
        """Reload environment variables dynamically."""
        self.api_key = settings.VLM_API_KEY
        self.base_url = settings.VLM_BASE_URL
        self.model_name = settings.VLM_MODEL_NAME
        if self.api_key:
            logger.info(f"[VLMAnalyzer] Dynamic reload successful! Base URL: {self.base_url}, Model: {self.model_name}")

    def _normalize_raw_output(self, raw_output: VLMRawOutput) -> Dict[str, Any]:
        """Normalize VLM emotion scores and dynamic secondary thresholding."""
        scores_dict = raw_output.emotion_scores.model_dump()
        raw_arr = np.array([max(0.0, float(scores_dict.get(k, 0.0))) for k in VALID_EMOTIONS])
        sum_scores = np.sum(raw_arr)
        
        if sum_scores > 0:
            norm_arr = raw_arr / sum_scores
        else:
            norm_arr = np.ones(7) / 7.0

        normalized_scores = {k: round(float(v), 4) for k, v in zip(VALID_EMOTIONS, norm_arr)}
        
        sorted_indices = np.argsort(norm_arr)[::-1]
        primary_idx = sorted_indices[0]
        primary_emotion = VALID_EMOTIONS[primary_idx]
        primary_prob = float(norm_arr[primary_idx])
        
        dynamic_threshold = max(0.10, primary_prob * 0.45)
        secondary_emotions = [
            VALID_EMOTIONS[idx] for idx in sorted_indices[1:]
            if norm_arr[idx] >= dynamic_threshold and VALID_EMOTIONS[idx] != primary_emotion
        ]

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
            "modelUsed": self.model_name
        }

    def analyze_post(self, text_content: str, image_inputs: List[Any]) -> Dict[str, Any]:
        """
        Analyze single multimodal post (text + image_inputs).
        """
        if not self.api_key:
            self.reload_env()
            
        if not self.api_key:
            raise RuntimeError("API Key not found for VLM. Please set VLM_API_KEY in .env")

        start_time = time.time()
        
        user_content = [{"type": "text", "text": f"Bài viết: \"{text_content}\"\nSố lượng hình ảnh đính kèm: {len(image_inputs)}"}]

        for img in image_inputs[:4]:
            compressed_url = self._compress_and_encode_image(img)
            user_content.append({"type": "image_url", "image_url": {"url": compressed_url}})

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
        logger.info(f"[VLMAnalyzer] Calling VLM API ({self.model_name}) for single post...")

        response = requests.post(endpoint, headers=headers, json=payload, timeout=40)
        if response.status_code != 200:
            raise RuntimeError(f"VLM API Error {response.status_code}: {response.text}")

        res_json = response.json()
        raw_content = res_json["choices"][0]["message"]["content"]
        parsed_data = json.loads(raw_content)

        raw_output = VLMRawOutput(**parsed_data)
        normalized = self._normalize_raw_output(raw_output)
        normalized["latencySeconds"] = round(time.time() - start_time, 3)

        return normalized

    def analyze_batch_posts(self, posts: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Analyze a batch of multimodal posts in a SINGLE VLM API Request.
        posts format: [{"id": "post_1", "text": "...", "images": [...]}, ...]
        Returns dict keyed by post_id -> normalized analysis result.
        """
        if not posts:
            return {}

        if not self.api_key:
            self.reload_env()
            
        if not self.api_key:
            raise RuntimeError("API Key not found for VLM. Please set VLM_API_KEY in .env")

        start_time = time.time()
        user_content = []

        user_content.append({
            "type": "text",
            "text": f"Danh sách {len(posts)} bài viết cần phân tích trong batch này:\n"
        })

        for p in posts:
            p_id = str(p.get("id"))
            p_text = str(p.get("text", ""))
            p_images = p.get("images", [])

            user_content.append({
                "type": "text",
                "text": f"\n--- BÀI VIẾT ID: {p_id} ---\nStatus: \"{p_text}\"\nĐính kèm {len(p_images)} ảnh dưới đây:"
            })

            for img in p_images[:4]:
                compressed_url = self._compress_and_encode_image(img)
                user_content.append({"type": "image_url", "image_url": {"url": compressed_url}})

        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": self.BATCH_SYSTEM_PROMPT},
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
        logger.info(f"[VLMAnalyzer] Calling VLM API Batch ({self.model_name}) for {len(posts)} posts in 1 request...")

        response = requests.post(endpoint, headers=headers, json=payload, timeout=60)
        if response.status_code != 200:
            raise RuntimeError(f"VLM API Batch Error {response.status_code}: {response.text}")

        res_json = response.json()
        raw_content = res_json["choices"][0]["message"]["content"]
        parsed_data = json.loads(raw_content)

        batch_output = VLMBatchRawOutput(**parsed_data)
        results = {}
        elapsed_time = round(time.time() - start_time, 3)

        for item in batch_output.results:
            normalized = self._normalize_raw_output(item)
            normalized["latencySeconds"] = elapsed_time
            results[item.id] = normalized

        return results


# Singleton instance
vlm_analyzer = VLMAnalyzer()
