import io
import os
import sys
import json
import base64
import time
import random
import asyncio
import logging
from typing import List, Dict, Any, Optional
import numpy as np
import httpx
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
    reasoning: Optional[str] = ""
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
# 2. VLM ANALYZER CLASS (ASYNC & HIGH-PERFORMANCE)
# ============================================================================

class VLMAnalyzer:
    """
    Unified Async VLM Analyzer for Multimodal Social Media Content.
    Features:
    - Pure Async Non-blocking HTTP (httpx.AsyncClient)
    - Zero redundant downloads (directly consumes ImageInput.bytes)
    - Parallel async image processing and resizing in threadpool
    - Exponential backoff retry for HTTP 429 / 503 errors
    - Token consumption optimization via Lanczos thumbnailing
    - Single-request batch inference
    """

    SYSTEM_PROMPT = """Bạn là Chuyên gia AI về Tính toán Cảm xúc Đa phương thức (Multimodal Affective Computing).
Nhiệm vụ: Phân tích bài đăng mạng xã hội (văn bản + hình ảnh/meme) và xác định DUY NHẤT 1 nhãn cảm xúc chủ đạo (strongest dominant emotion) của người đăng trong 7 nhóm:
[joy, sadness, anger, fear, disgust, surprise, neutral]

HƯỚNG DẪN 7 NHÃN CẢM XÚC:
- [joy]: Vui vẻ, hài hước, hạnh phúc, tán dương, giải trí tích cực.
- [sadness]: Buồn bã, đau lòng, thất vọng, tiếc nuối, mất mát, bi kịch.
- [anger]: Tức giận, bực bội, bức xúc, phẫn nộ, bất bình công kích việc sai trái hoặc kẻ gây hại.
- [disgust]: Ghê tởm (dơ bẩn thể xác) HOẶC sự ngán ngẩm, khinh miệt, coi thường trước sự giả tạo, trò hề lố lăng, phốt drama (thái độ bài xích, kinh ngán).
- [fear]: Sợ hãi, hoảng hốt, lo âu, bất an, cảm giác đe dọa trước hiểm họa, tội phạm.
- [surprise]: Ngạc nhiên, ngỡ ngàng, sửng sốt trước điều bất ngờ, khó tin.
- [neutral]: Khách quan, trung tính thuần túy, tin tức thông báo đời thường không bộc lộ cảm xúc rõ nét.

QUY TẮC PHÂN ĐỊNH CÁC RANH GIỚI DỄ NHẦM LẪN:
1. ANGER vs DISGUST (Khi bài đăng mang sắc thái tiêu cực hoặc châm biếm):
   - Gán [anger] khi thái độ chính là BỰC TỨC / PHẪN NỘ / BẤT BÌNH CÔNG KÍCH: Người đăng bực bội, gay gắt lên án, phản đối hành động của đối tượng.
   - Gán [disgust] khi thái độ chính là NGÁN NGẨM / KHINH BỈ / COI THƯỜNG: Người đăng chê bai thói giả tạo, coi đối tượng như trò hề lố lăng, rẻ tiền, khinh ngán xa lánh.
2. SURPRISE vs JOY (Khi bài đăng thể hiện biểu cảm ngỡ ngàng hoặc meme hài):
   - Gán [surprise] khi ngỡ ngàng, sửng sốt, khó tin trước sự việc bất ngờ, cú twist hoặc tình huống trái kỳ vọng.
   - Gán [joy] khi trọng tâm là sự tận hưởng, vui vẻ, hạnh phúc, giải trí tích cực thuần túy mà không có yếu tố ngỡ ngàng/bất ngờ chiếm ưu thế.
3. JOY vs DISGUST: Meme châm biếm/pha trò gây cười ưu tiên [joy]; chỉ gán [disgust] khi toát lên sự bài xích, khinh miệt tiêu cực sâu sắc.

QUY TẮC SUY LUẬN & KIỂM DUYỆT (CONTENT MODERATION):
- Đọc kỹ cả văn bản và chữ nhúng trong ảnh/meme (OCR).
- Tóm tắt 1 câu ngắn gọn trong 'reasoning' giải thích lý do trước khi chốt nhãn cảm xúc.
- Sarcasm: Đặt is_sarcasm_or_conflict = True nếu dùng lời mỉa mai nói ngược, gán nhãn theo cảm xúc thật của tác giả.
- KIỂM DUYỆT NỘI DUNG (content_moderation):
  + is_flagged: True nếu vi phạm tiêu chuẩn cộng đồng, False nếu an toàn.
  + flagged_categories: Danh sách vi phạm (chỉ dùng các từ khóa chuẩn sau):
    * "self_harm": Hình ảnh/hành vi tự cắt tay, tự gây thương tích, thòng lọng, tự tử.
    * "graphic_violence": Bạo lực máu me, vết thương hở, tai nạn ghê rợn, xác chết, đánh chém tàn nhẫn.
    * "weapon_threat": Vũ khí nguy hiểm (súng, dao kiếm chĩa đe dọa), bom mìn, đe dọa vũ lực.
    * "nsfw_adult": Khỏa thân, khiêu dâm, đồi trụy 18+.
    * "hate_speech": Ngôn từ/meme thù ghét, xúc phạm, công kích danh dự, tôn giáo, sắc tộc.
    * "profanity_venting": Ngôn từ thô mộc, chửi bậy xả stress nhẹ trên ảnh/meme.
  + confidence: Mức độ tin cậy vi phạm (0.0 đến 1.0).
  + reason: Giải thích ngắn gọn lý do vi phạm nếu có.

CẤU TRÚC JSON PHẢI TRẢ VỀ:
{
  "reasoning": "Tóm tắt ngắn gọn 1 câu phân tích ngữ cảnh và cảm xúc chủ đạo.",
  "content_moderation": {"is_flagged": false, "flagged_categories": [], "confidence": 0.0, "reason": ""},
  "emotion_scores": {"joy": 0.0, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "disgust": 0.0, "surprise": 0.0, "neutral": 0.0},
  "primary_emotion": "<1 trong 7 nhãn>",
  "final_confidence": 0.85,
  "intensity": "moderate",
  "is_sarcasm_or_conflict": false,
  "conflict_explanation": "",
  "mental_health_risk_level": "none",
  "suggested_action": "NO_ACTION"
}
Chú ý:
- mental_health_risk_level thuộc: ["none", "weak", "medium", "high", "critical"]
- suggested_action thuộc: ["NO_ACTION", "MONITOR", "TRIGGER_PROACTIVE_CHECKIN"]
"""

    BATCH_SYSTEM_PROMPT = """Bạn là Chuyên gia AI về Tính toán Cảm xúc Đa phương thức (Multimodal Affective Computing).
Nhiệm vụ: Phân tích danh sách bài đăng (văn bản + hình ảnh/meme) và gán DUY NHẤT 1 nhãn cảm xúc chủ đạo:
[joy, sadness, anger, fear, disgust, surprise, neutral]

ĐỊNH NGHĨA 7 NHÃN:
- [joy]: Vui vẻ, hài hước, hạnh phúc, tán dương, tích cực.
- [sadness]: Buồn bã, đau lòng, thất vọng, tiếc nuối, mất mát.
- [anger]: Tức giận, bực bội, bức xúc, phẫn nộ, bất bình công kích đối tượng sai trái.
- [disgust]: Ghê tởm dơ bẩn HOẶC khinh miệt, ngán ngẩm, coi thường thói giả tạo, trò hề lố lăng, phốt drama.
- [fear]: Sợ hãi, hoảng hốt, lo âu, bất an trước hiểm họa, tội phạm.
- [surprise]: Ngạc nhiên, ngỡ ngàng, sửng sốt trước điều bất ngờ, khó tin.
- [neutral]: Khách quan, trung tính, thông tin đời thường không bộc lộ cảm xúc rõ nét.
QUY TẮC PHÂN ĐỊNH:
- ANGER (bực tức, phẫn nộ, bất bình công kích) vs DISGUST (ngán ngẩm, khinh bỉ, coi thường trò hề lố lăng/đạo đức giả).
- SURPRISE (sững sờ, ngỡ ngàng trước biến cố/twist/vi phạm kỳ vọng khó tin) vs JOY (vui vẻ, giải trí tích cực thuần túy).
- JOY vs DISGUST: Meme châm biếm/pha trò gây cười ưu tiên [joy]; chỉ gán [disgust] khi bài xích, khinh miệt tiêu cực sâu sắc.

KIỂM DUYỆT NỘI DUNG (content_moderation):
- is_flagged: true nếu vi phạm, false nếu an toàn.
- flagged_categories: chọn trong ["self_harm", "graphic_violence", "weapon_threat", "nsfw_adult", "hate_speech", "profanity_venting"].

CẤU TRÚC JSON:
{"results": [{"id": "post_id", "reasoning": "Phân tích 1 câu", "content_moderation": {"is_flagged": false, "flagged_categories": [], "confidence": 0.0, "reason": ""}, "emotion_scores": {"joy": 0.0, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "disgust": 0.0, "surprise": 0.0, "neutral": 0.0}, "primary_emotion": "<1 trong 7 nhãn>", "final_confidence": 0.85, "intensity": "moderate", "is_sarcasm_or_conflict": false, "conflict_explanation": "", "mental_health_risk_level": "none", "suggested_action": "NO_ACTION"}]}"""

    def __init__(self):
        self.api_key = settings.VLM_API_KEY
        self.base_url = settings.VLM_BASE_URL
        self.model_name = settings.VLM_MODEL_NAME
        self._async_client: Optional[httpx.AsyncClient] = None
        logger.info(f"[VLMAnalyzer] Initialized with Base URL: {self.base_url}, Model: {self.model_name}")

    async def get_client(self) -> httpx.AsyncClient:
        """Get or create singleton AsyncClient."""
        if self._async_client is None or self._async_client.is_closed:
            self._async_client = httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=20, max_connections=50)
            )
        return self._async_client

    async def close(self):
        """Close HTTP client on shutdown."""
        if self._async_client and not self._async_client.is_closed:
            await self._async_client.aclose()

    def reload_env(self):
        """Reload environment variables dynamically."""
        self.api_key = settings.VLM_API_KEY
        self.base_url = settings.VLM_BASE_URL
        self.model_name = settings.VLM_MODEL_NAME
        if self.api_key:
            logger.info(f"[VLMAnalyzer] Dynamic reload successful! Base URL: {self.base_url}, Model: {self.model_name}")

    # ========================================================================
    # IMAGE PROCESSING (CPU-bound in Threadpool + Zero Double-download)
    # ========================================================================

    @staticmethod
    def _resize_and_compress_sync(raw_bytes: bytes, max_size: int, quality: int) -> str:
        """CPU-bound image resizing and JPEG Base64 encoding."""
        img = Image.open(io.BytesIO(raw_bytes))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=quality, optimize=True)
        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{encoded}"

    async def _compress_and_encode_image_async(
        self,
        image_source: Any,
        client: httpx.AsyncClient,
        max_size: Optional[int] = None,
        quality: Optional[int] = None
    ) -> str:
        """
        Compress image asynchronously without blocking event loop.
        Directly reuses ImageInput.bytes if available.
        """
        if max_size is None:
            max_size = settings.VLM_MAX_IMAGE_SIZE
        if quality is None:
            quality = settings.VLM_IMAGE_QUALITY

        raw_bytes: Optional[bytes] = None

        # Case 1: ImageInput object with bytes attribute
        if hasattr(image_source, "bytes") and image_source.bytes:
            raw_bytes = image_source.bytes
        elif isinstance(image_source, bytes):
            raw_bytes = image_source
        elif isinstance(image_source, str):
            # Case 2: Already base64 data url
            if image_source.startswith("data:image"):
                try:
                    _, base64_str = image_source.split(",", 1)
                    raw_bytes = base64.b64decode(base64_str)
                except Exception:
                    return image_source
            # Case 3: Local file path
            elif os.path.exists(image_source):
                try:
                    with open(image_source, "rb") as f:
                        raw_bytes = f.read()
                except Exception as e:
                    logger.warning(f"[VLMAnalyzer] Failed to read local image path: {e}")
                    return image_source
            # Case 4: Remote HTTP/HTTPS URL (fallback for direct API callers)
            elif image_source.startswith("http://") or image_source.startswith("https://"):
                try:
                    resp = await client.get(image_source, timeout=10.0)
                    if resp.status_code == 200:
                        raw_bytes = resp.content
                    else:
                        logger.warning(f"[VLMAnalyzer] Fetch image URL failed (status={resp.status_code}): {image_source}")
                        return image_source
                except Exception as e:
                    logger.warning(f"[VLMAnalyzer] Async image download failed: {e}")
                    return image_source
            else:
                return str(image_source)
        elif hasattr(image_source, "url") and image_source.url:
            # Object has url only
            return await self._compress_and_encode_image_async(image_source.url, client, max_size, quality)
        else:
            return str(image_source)

        if not raw_bytes:
            return str(image_source)

        try:
            return await asyncio.to_thread(self._resize_and_compress_sync, raw_bytes, max_size, quality)
        except Exception as e:
            logger.warning(f"[VLMAnalyzer] Image compression failed: {e}. Falling back to raw source.")
            return str(image_source)

    # ========================================================================
    # OUTPUT NORMALIZATION
    # ========================================================================

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
        
        # Chuẩn Đơn nhãn (Single-label): Tự động map secondaryEmotions thành [] để tương thích schema DTO hệ thống
        secondary_emotions: List[str] = []

        return {
            "modality": "UNIFIED_MULTIMODAL_VLM",
            "reasoning": getattr(raw_output, "reasoning", ""),
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

    # ========================================================================
    # API CALL WITH RETRY & EXPONENTIAL BACKOFF
    # ========================================================================

    async def _call_vlm_api_with_retry(
        self,
        client: httpx.AsyncClient,
        payload: Dict[str, Any],
        timeout: float = 40.0,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """Call VLM API with exponential backoff for Rate Limits (429) and Server Errors (503)."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        endpoint = f"{self.base_url.rstrip('/')}/chat/completions"

        last_error = None

        for attempt in range(1, max_retries + 1):
            try:
                resp = await client.post(endpoint, headers=headers, json=payload, timeout=timeout)
                
                if resp.status_code == 200:
                    return resp.json()
                
                # Retryable status codes
                if resp.status_code in (429, 500, 502, 503, 504):
                    backoff = (2 ** (attempt - 1)) * 1.0 + random.uniform(0.1, 0.4)
                    logger.warning(
                        f"[VLMAnalyzer] API status={resp.status_code} (attempt {attempt}/{max_retries}). "
                        f"Backing off for {backoff:.2f}s... Response: {resp.text[:150]}"
                    )
                    last_error = RuntimeError(f"VLM API Error {resp.status_code}: {resp.text}")
                    if attempt < max_retries:
                        await asyncio.sleep(backoff)
                        continue
                else:
                    raise RuntimeError(f"VLM API Non-retryable Error {resp.status_code}: {resp.text}")

            except (httpx.TimeoutException, httpx.NetworkError) as e:
                backoff = (2 ** (attempt - 1)) * 1.0 + random.uniform(0.1, 0.4)
                logger.warning(f"[VLMAnalyzer] Network error ({type(e).__name__}) on attempt {attempt}/{max_retries}. Backoff {backoff:.2f}s...")
                last_error = e
                if attempt < max_retries:
                    await asyncio.sleep(backoff)
                    continue

        raise last_error or RuntimeError("VLM API Call exhausted all retries.")

    # ========================================================================
    # PUBLIC ASYNC METHODS
    # ========================================================================

    async def analyze_post(self, text_content: str, image_inputs: List[Any]) -> Dict[str, Any]:
        """
        Analyze single multimodal post (text + image_inputs) asynchronously.
        """
        if not self.api_key:
            self.reload_env()
            
        if not self.api_key:
            raise RuntimeError("API Key not found for VLM. Please set VLM_API_KEY in .env")

        start_time = time.time()
        client = await self.get_client()

        # Parallel image compression
        selected_images = image_inputs[:4]
        compressed_urls = await asyncio.gather(
            *[self._compress_and_encode_image_async(img, client) for img in selected_images]
        )

        user_content: List[Dict[str, Any]] = [
            {"type": "text", "text": f"Bài viết: \"{text_content}\"\nSố lượng hình ảnh đính kèm: {len(compressed_urls)}"}
        ]

        for comp_url in compressed_urls:
            user_content.append({"type": "image_url", "image_url": {"url": comp_url}})

        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": user_content}
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }

        logger.info(f"[VLMAnalyzer] Calling VLM API ({self.model_name}) for single post (images={len(compressed_urls)})...")
        res_json = await self._call_vlm_api_with_retry(client, payload, timeout=60.0, max_retries=4)

        raw_content = res_json["choices"][0]["message"]["content"]
        parsed_data = json.loads(raw_content)

        raw_output = VLMRawOutput(**parsed_data)
        normalized = self._normalize_raw_output(raw_output)
        normalized["latencySeconds"] = round(time.time() - start_time, 3)

        return normalized

    async def analyze_batch_posts(self, posts: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
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
        client = await self.get_client()

        user_content: List[Dict[str, Any]] = [{
            "type": "text",
            "text": f"Danh sách {len(posts)} bài viết cần phân tích trong batch này:\n"
        }]

        for p in posts:
            p_id = str(p.get("id"))
            p_text = str(p.get("text", ""))
            p_images = p.get("images", [])[:4]

            compressed_urls = await asyncio.gather(
                *[self._compress_and_encode_image_async(img, client) for img in p_images]
            )

            user_content.append({
                "type": "text",
                "text": f"\n--- BÀI VIẾT ID: {p_id} ---\nStatus: \"{p_text}\"\nĐính kèm {len(compressed_urls)} ảnh dưới đây:"
            })

            for comp_url in compressed_urls:
                user_content.append({"type": "image_url", "image_url": {"url": comp_url}})

        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": self.BATCH_SYSTEM_PROMPT},
                {"role": "user", "content": user_content}
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }

        logger.info(f"[VLMAnalyzer] Calling VLM API Batch ({self.model_name}) for {len(posts)} posts in 1 request...")
        res_json = await self._call_vlm_api_with_retry(client, payload, timeout=60.0)

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
