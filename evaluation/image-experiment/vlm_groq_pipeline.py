import os
import sys
import json
import base64
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
import requests
from pydantic import BaseModel, Field

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


# ============================================================================
# 1. ENV LOADER (Tự động đọc .env giống evaluation/pipeline/augment_goemotions_llm.py)
# ============================================================================

def parse_dot_env(file_path: Path) -> Dict[str, str]:
    """Parse local .env file manually when Python script executes."""
    env_vars = {}
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env_vars[k.strip()] = v.strip().strip("'").strip('"')
        except Exception:
            pass
    return env_vars


def load_env_vars():
    """Load API environment variables automatically from evaluation/.env or OS shell."""
    eval_env = Path(__file__).parent.parent / ".env"
    file_vars = parse_dot_env(eval_env)

    api_key = (
        os.getenv("GROQ_API_KEY")
        or file_vars.get("GROQ_API_KEY")
    )
    base_url = (
        os.getenv("GROQ_BASE_URL")
        or file_vars.get("GROQ_BASE_URL")
        or "https://api.groq.com/openai/v1"
    )
    model_name = (
        os.getenv("GROQ_MODEL_NAME")
        or file_vars.get("GROQ_MODEL_NAME")
        or "llama-3.2-11b-vision-instruct"
    )

    return api_key, base_url, model_name


# ============================================================================
# 2. SCHEMAS (7 EKMAN EMOTIONS & INTEGRATED MODERATION)
# ============================================================================

VALID_EMOTIONS = ["joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral"]


class EmotionScores(BaseModel):
    joy: float = Field(default=0.0, ge=0.0, le=1.0)
    sadness: float = Field(default=0.0, ge=0.0, le=1.0)
    anger: float = Field(default=0.0, ge=0.0, le=1.0)
    fear: float = Field(default=0.0, ge=0.0, le=1.0)
    disgust: float = Field(default=0.0, ge=0.0, le=1.0)
    surprise: float = Field(default=0.0, ge=0.0, le=1.0)
    neutral: float = Field(default=0.0, ge=0.0, le=1.0)


class ContentModeration(BaseModel):
    is_flagged: bool = Field(description="True nếu vi phạm an toàn")
    flagged_categories: List[str] = Field(default_factory=list, description="NSFW, GRAPHIC_VIOLENCE, SELF_HARM_SIGNALS, HATE_SPEECH")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reason: Optional[str] = Field(default="", description="Lý do vi phạm")


class UnifiedMultimodalResult(BaseModel):
    modality: str = "UNIFIED_MULTIMODAL_VLM"
    primary_emotion: str
    secondary_emotions: List[str] = Field(default_factory=list)
    final_confidence: float = Field(ge=0.0, le=1.0)
    intensity: str
    emotion_scores: EmotionScores
    is_sarcasm_or_conflict: bool
    conflict_explanation: Optional[str] = ""
    content_moderation: ContentModeration
    mental_health_risk_level: str
    suggested_action: str


# ============================================================================
# 3. UNIFIED VLM ANALYZER CLASS (HTTP REST VIA REQUESTS)
# ============================================================================

class GroqUnifiedVLMAnalyzer:
    """
    Pipeline Phân tích Đa phương thức Tích hợp 100% (VLM REST API).
    Sử dụngrequests.post() trực tiếp tới API endpoint tương thích OpenAI/Groq.
    """

    SYSTEM_PROMPT = """Bạn là Trợ lý AI Phân tích Đa phương thức Tích hợp cho Mạng Xã Hội Hỗ trợ Sức khỏe Tâm thần.
Nhiệm vụ: Phân tích bài viết đính kèm văn bản và danh sách hình ảnh.

BẮT BUỘC TRẢ VỀ JSON DUY NHẤT CHỨA CÁC TRƯỜNG:
1. emotion_scores (Tập 7 nhãn Ekman: "joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral").
2. primary_emotion & secondary_emotions (các nhãn có score >= 0.35).
3. is_sarcasm_or_conflict & conflict_explanation (Phát hiện mâu thuẫn giữa Status và Ảnh).
4. content_moderation (is_flagged, flagged_categories, confidence, reason).
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
  "conflict_explanation": "Status viết vui vẻ nhưng ảnh u uất.",
  "content_moderation": {
    "is_flagged": false,
    "flagged_categories": [],
    "confidence": 0.95,
    "reason": ""
  },
  "mental_health_risk_level": "medium",
  "suggested_action": "TRIGGER_PROACTIVE_CHECKIN"
}
"""

    def __init__(self):
        self.api_key, self.base_url, self.model_name = load_env_vars()
        print(f"[GroqUnifiedVLMAnalyzer] Base URL: {self.base_url}")
        print(f"[GroqUnifiedVLMAnalyzer] API Key set: {'Yes' if self.api_key else 'No'}")
        
        # Tự động list các models khả dụng trên endpoint
        available_models = self.get_available_models()
        if available_models:
            print(f"[GroqUnifiedVLMAnalyzer] Các model khả dụng trên API: {available_models}")
            # Tìm vision model thích hợp
            vision_models = [m for m in available_models if any(x in m.lower() for x in ['vision', 'llama-3.2', 'llava', 'maestro', 'qwen', 'gemini', 'gpt'])]
            if vision_models:
                print(f"[GroqUnifiedVLMAnalyzer] Các model Vision tìm thấy: {vision_models}")
                if self.model_name not in available_models:
                    self.model_name = vision_models[0]
                    print(f"[GroqUnifiedVLMAnalyzer] => Đã tự động chọn model Vision khả dụng: {self.model_name}")
            else:
                if self.model_name not in available_models:
                    self.model_name = available_models[0]
                    print(f"[GroqUnifiedVLMAnalyzer] => Chọn model fallback: {self.model_name}")
        else:
            print(f"[GroqUnifiedVLMAnalyzer] Model Name configured: {self.model_name}")

    def get_available_models(self) -> List[str]:
        if not self.api_key:
            return []
        try:
            endpoint = f"{self.base_url.rstrip('/')}/models"
            headers = {"Authorization": f"Bearer {self.api_key}"}
            resp = requests.get(endpoint, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                return [m["id"] for m in data]
        except Exception as e:
            print(f"[WARN] Không thể lấy danh sách models từ API: {e}")
        return []

    def _encode_image_to_base64(self, image_path: str) -> str:
        ext = os.path.splitext(image_path)[1].lower().replace('.', '')
        mime_type = "image/png" if ext == "png" else "image/jpeg"
        with open(image_path, "rb") as img_file:
            base64_data = base64.b64encode(img_file.read()).decode("utf-8")
        return f"data:{mime_type};base64,{base64_data}"

    def analyze_post(self, text_content: str, image_inputs: List[str]) -> Dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("Chưa tìm thấy API Key. Vui lòng cấu hình GROQ_API_KEY hoặc LLM_API_KEY trong evaluation/.env")

        start_time = time.time()
        user_content = [{"type": "text", "text": f"Bài viết: \"{text_content}\"\nSố ảnh đính kèm: {len(image_inputs)}"}]

        for img_input in image_inputs[:4]:
            if img_input.startswith("http://") or img_input.startswith("https://") or img_input.startswith("data:image"):
                img_url = img_input
            elif os.path.exists(img_input):
                img_url = self._encode_image_to_base64(img_input)
            else:
                continue
            
            user_content.append({
                "type": "image_url",
                "image_url": {"url": img_url}
            })

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
        print(f"[GroqUnifiedVLMAnalyzer] Calling REST endpoint: {endpoint} ...")

        response = requests.post(endpoint, headers=headers, json=payload, timeout=45)
        if response.status_code != 200:
            raise RuntimeError(f"API Error {response.status_code}: {response.text}")

        res_json = response.json()
        raw_content = res_json["choices"][0]["message"]["content"]
        parsed_data = json.loads(raw_content)

        parsed_data["latency_seconds"] = round(time.time() - start_time, 3)
        parsed_data["model_used"] = self.model_name

        validated = UnifiedMultimodalResult(**parsed_data)
        return validated.model_dump()


# ============================================================================
# 4. CLI DEMO SCRIPT
# ============================================================================

if __name__ == "__main__":
    print("=" * 70)
    print("  PIPELINE THỬ NGHIỆM VLM TÍCH HỢP 100% (CẢM XÚC + KIỂM DUYỆT)")
    print("=" * 70)

    
    analyzer = GroqUnifiedVLMAnalyzer()
    
    sample_text = "Đường đẹp quá nhỉ =)), đi một lần nhớ mãi!"
    sample_images = [
        "https://t.ex-cdn.com/nongnghiepmoitruong.vn/608w/files/content/2025/07/28/sequence-0100_50_54_03still001-142201_2-172207.jpeg"
    ]
    
    print(f"\n[Test Scenario] Status: \"{sample_text}\"")
    print(f"[Test Scenario] Images count: {len(sample_images)}")
    
    if analyzer.api_key:
        try:
            result = analyzer.analyze_post(sample_text, sample_images)
            print("\n[RESULT UNIFIED JSON OUTPUT]:")
            print(json.dumps(result, indent=2, ensure_ascii=False))
        except Exception as err:
            print(f"\n[FAIL] Chạy thử nghiệm thất bại: {err}")
    else:
        print("\n[INFO] Đã khởi tạo thành công. Vui lòng thiết lập API Key trong evaluation/.env để thực thi live call.")
