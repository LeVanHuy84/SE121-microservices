"""
========================================================================================
BATCH GEMINI VLM ANNOTATOR FOR MULTIMODAL BENCHMARK SAMPLES
========================================================================================
Dự án: SE121 Microservices Platform — Mạng xã hội hỗ trợ Sức khỏe Tâm thần (KLTN)
Tham chiếu chuẩn:
  - Cẩm nang Quy chuẩn Gán nhãn: evaluation/image-experiment/annotation_guidelines.md

Mục đích:
  Chạy gán nhãn tự động bằng Gemini VLM trên tập mẫu bài đăng MXH:
    - Bóc tách đầy đủ 4 trường cốt lõi theo Annotation Guidelines:
        1. text_only_emotion (Cảm xúc theo riêng văn bản - 7 Ekman)
        2. image_only_emotion (Cảm xúc theo riêng hình ảnh - 7 Ekman)
        3. combined_emotion (Cảm xúc tổng hợp toàn bài đăng - 7 Ekman)
        4. relationship_type (Phân loại quan hệ Ảnh-Chữ: CONGRUENT | INCONGRUENT | COMPLEMENTARY)
        + explanation (Lời giải thích ngắn gọn 1-2 câu tiếng Việt)
    - Đồng bộ chuẩn schema vlm_proposal và human_review (đầy đủ cả 4 trường).

Tính năng an toàn & chuẩn mực:
  1. TÁCH FILE RIÊNG BIỆT: File đầu vào gốc giữ nguyên 100%, kết quả ghi độc lập vào file output.
  2. Phân tích đến đâu LƯU ĐẾN ĐÓ ngay lập tức (Instant Checkpoint).
  3. KIỂM TRA CHẶT CHẼ (Strict Validation): Tuyệt đối KHÔNG tự ý ép về neutral/CONGRUENT khi LLM
     trả về sai nhãn; nếu sau các lần thử lại vẫn sai sẽ gắn cờ lỗi (FLAGGED_INVALID_SCHEMA).
  4. Bắt lỗi HTTP 429 (Rate Limit / Quota) & HTTP 503 (High Demand): Tự động chờ hồi phục hoặc
     fallback sang model dự phòng (gemini-2.5-flash-lite / gemini-flash-latest / gemini-3.5-flash).
  5. Hỗ trợ Resume: Khi chạy lại, tự động bỏ qua các mẫu đã hoàn thành đủ 4 trường thành công.

Cách chạy:
  # Chạy thử 5 mẫu đầu tiên:
  python evaluation/image-experiment/batch_annotate_gemini.py --max-samples 5

  # Chạy với file đầu vào / đầu ra tùy chọn:
  python evaluation/image-experiment/batch_annotate_gemini.py --input evaluation/image-experiment/data/candidate_1000_benchmark_pool.json --output evaluation/image-experiment/data/vlm_preannotated_1000_benchmark.json
========================================================================================
"""

import os
import sys
import json
import time
import base64
import logging
import argparse
from pathlib import Path
from typing import Optional, Dict, Any, List
import requests

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent.parent
DATA_DIR = BASE_DIR / "data"

DEFAULT_INPUT_FILE = DATA_DIR / "candidate_1000_benchmark_pool.json" if (DATA_DIR / "candidate_1000_benchmark_pool.json").exists() else DATA_DIR / "rare_100_candidates.json"
DEFAULT_OUTPUT_FILE = DATA_DIR / "vlm_preannotated_1000_benchmark.json" if (DATA_DIR / "candidate_1000_benchmark_pool.json").exists() else DATA_DIR / "rare_100_annotated.json"

VALID_EMOTIONS = ["joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral"]
VALID_RELATIONSHIPS = ["CONGRUENT", "INCONGRUENT", "COMPLEMENTARY"]


# ============================================================================
# API KEY LOADER (SILENT & SECURE)
# ============================================================================

def get_gemini_api_key() -> Optional[str]:
    """Tìm nạp API key từ biến môi trường hoặc các file .env trong project trong bộ nhớ."""
    for key_name in ["GEMINI_API", "GEMINI_API_KEY", "GOOGLE_API_KEY"]:
        val = os.getenv(key_name)
        if val:
            return val.strip()

    candidate_env_paths = [
        ROOT_DIR / ".env",
        ROOT_DIR / "evaluation" / ".env",
        Path(".env"),
        Path("evaluation/.env")
    ]

    for env_path in candidate_env_paths:
        if env_path.exists():
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'").strip('"')
                            if k in ["GEMINI_API", "GEMINI_API_KEY", "GOOGLE_API_KEY"] and v:
                                return v
            except Exception:
                pass
    return None


# ============================================================================
# IMAGE & API HELPERS
# ============================================================================

from PIL import Image

def validate_and_encode_image(image_path: Path) -> tuple[str, str]:
    """
    Kiểm tra tính toàn vẹn của tệp ảnh bằng PIL trước khi gửi.
    Nếu ảnh bị lỗi hoặc định dạng không chuẩn, chuyển đổi an toàn sang JPEG RGB.
    """
    if not image_path.exists() or image_path.stat().st_size == 0:
        raise ValueError(f"Tệp ảnh không tồn tại hoặc rỗng: {image_path}")

    # 1. Kiểm tra tính toàn vẹn bằng PIL
    try:
        with Image.open(image_path) as img:
            img.verify()  # Phát hiện lỗi file hỏng/corrupted
    except Exception as e:
        raise ValueError(f"Tệp ảnh bị hỏng (corrupted): {image_path} ({e})")

    # 2. Mở lại để kiểm tra định dạng và chuẩn hóa sang JPEG RGB nếu cần
    try:
        with Image.open(image_path) as img:
            fmt = (img.format or "").upper()
            if fmt in ["JPEG", "JPG"]:
                mime_type = "image/jpeg"
                with open(image_path, "rb") as f:
                    encoded = base64.b64encode(f.read()).decode("utf-8")
                return encoded, mime_type
            elif fmt == "PNG":
                mime_type = "image/png"
                with open(image_path, "rb") as f:
                    encoded = base64.b64encode(f.read()).decode("utf-8")
                return encoded, mime_type
            elif fmt == "WEBP":
                mime_type = "image/webp"
                with open(image_path, "rb") as f:
                    encoded = base64.b64encode(f.read()).decode("utf-8")
                return encoded, mime_type
            else:
                # Chuyển đổi định dạng lạ (GIF, BMP, TIFF...) sang JPEG RGB chuẩn
                rgb_img = img.convert("RGB")
                import io
                buf = io.BytesIO()
                rgb_img.save(buf, format="JPEG", quality=90)
                encoded = base64.b64encode(buf.getvalue()).decode("utf-8")
                return encoded, "image/jpeg"
    except Exception as e:
        raise ValueError(f"Không thể xử lý/chuyển đổi ảnh {image_path}: {e}")


def build_annotation_prompt(text_vi: str = "", text_en: str = "") -> str:
    """Tạo prompt chuẩn hóa bóc tách đủ 4 trường cảm xúc & quan hệ theo Annotation Guidelines."""
    if text_en and text_vi and text_en.strip() != text_vi.strip():
        text_info = f'- Văn bản gốc (English): "{text_en.strip()}"\n- Văn bản dịch (Tiếng Việt): "{text_vi.strip()}"'
    else:
        content = (text_vi or text_en or "").strip()
        text_info = f'- Văn bản bài đăng: "{content}"'

    return f"""Bạn là chuyên gia AI hàng đầu về Phân tích Cảm xúc Đa phương thức (Multimodal Emotion Analysis) trên Mạng xã hội, phục vụ hệ thống theo dõi sức khỏe tinh thần người dùng.

Nhiệm vụ: Phân tích bài đăng mạng xã hội dưới đây gồm cả HÌNH ẢNH và VĂN BẢN (Text - Image):
{text_info}
- Hình ảnh đính kèm: [Xem hình ảnh được cung cấp]

NGUYÊN TẮC CỐT LÕI (POSTER-CENTRIC):
- Mục tiêu tối thượng là nhận diện TRẠNG THÁI TÂM LÝ CỦA CHÍNH NGƯỜI ĐĂNG BÀI (Poster's Emotion), KHÔNG PHẢI cảm xúc của nhân vật trong ảnh hay cảm xúc của người đọc lướt qua.
- Nếu bài đăng chỉ là chia sẻ tin tức thời sự khách quan, thông báo kỹ thuật, hoặc trích dẫn danh ngôn/triết lý mà người đăng không bộc lộ cảm xúc cá nhân nổi trội (dù người trong ảnh đang cười hay khóc) -> CẢM XÚC TỔNG HỢP PHẢI CHỌN "neutral".

Dựa trên Cẩm nang Quy chuẩn Gán nhãn (Annotation Guidelines) theo yêu cầu học thuật:
HÃY ĐÁNH GIÁ ĐỘC LẬP TỪNG PHƯƠNG THỨC VÀ TỔNG HỢP, XUẤT RA JSON VỚI ĐÚNG 5 TRƯỜNG DƯỚI ĐÂY:

1. "text_only_emotion": Cảm xúc nổi trội của RIÊNG VĂN BẢN khi chỉ đọc câu chữ/status mà KHÔNG xem hình ảnh (Đặt câu hỏi: Nếu chỉ nhận tin nhắn SMS này không có ảnh thì mang cảm xúc gì?). Chọn chính xác 1 trong 7 nhãn Ekman: ["joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral"].
2. "image_only_emotion": Cảm xúc nổi trội của RIÊNG BỨC ẢNH khi chỉ xem hình ảnh mà KHÔNG đọc status bên ngoài (Lưu ý: Nếu ảnh là meme có chữ in sẵn trên ảnh, ĐƯỢC PHÉP đọc chữ nhúng để hiểu nội dung meme). Chọn chính xác 1 trong 7 nhãn Ekman: ["joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral"].
3. "combined_emotion": Cảm xúc thực tế và nổi trội nhất của CHÍNH NGƯỜI ĐĂNG khi kết hợp đồng thời cả Văn bản và Hình ảnh trong bối cảnh mạng xã hội (Lưu ý: mỉa mai/cà khịa/tự trào gây cười thì chọn "joy"; bài trích dẫn tin tức khách quan chọn "neutral"). Chọn chính xác 1 trong 7 nhãn Ekman: ["joy", "sadness", "anger", "fear", "disgust", "surprise", "neutral"].
4. "relationship_type": Mối quan hệ tương tác ngữ nghĩa & cảm xúc giữa Ảnh và Chữ. Chọn chính xác 1 trong 3 loại:
   - "CONGRUENT": Đồng nhất / Củng cố trực tiếp (Ảnh và Chữ cùng chung một thông điệp, cùng hướng cảm xúc; ảnh minh họa cho điều chữ đã nói).
   - "COMPLEMENTARY": Bổ trợ ngữ cảnh (Một bên trung tính/thiếu thông tin HOẶC hai bên lệch sắc thái mang tính xoa dịu/an ủi/giải thích bối cảnh mà KHÔNG mỉa mai).
   - "INCONGRUENT": Mâu thuẫn / Mỉa mai / Châm biếm (Nghĩa đen câu chữ đối lập có chủ đích với hình ảnh để mỉa mai, cà khịa, giễu cợt hoặc tự trào hài hước).
5. "explanation": Lời giải thích ngắn gọn (1-2 câu tiếng Việt) nêu rõ căn cứ nhận định 3 nhãn cảm xúc và mối quan hệ ảnh-chữ trên.

Định dạng trả về: JSON thuần túy theo mẫu sau:
{{
  "text_only_emotion": "joy",
  "image_only_emotion": "neutral",
  "combined_emotion": "joy",
  "relationship_type": "COMPLEMENTARY",
  "explanation": "Lời giải thích bằng tiếng Việt..."
}}"""


def is_sample_annotated_with_all_fields(sample: Dict[str, Any]) -> bool:
    """Kiểm tra mẫu đã có đầy đủ 4 trường cảm xúc và quan hệ hay chưa."""
    prop = sample.get("vlm_proposal")
    if not prop or not isinstance(prop, dict):
        return False
    if not prop.get("is_valid", True):
        return False

    toe = prop.get("text_only_emotion")
    ioe = prop.get("image_only_emotion")
    ce = prop.get("combined_emotion")
    rel = prop.get("relationship_type")

    return (
        toe in VALID_EMOTIONS and
        ioe in VALID_EMOTIONS and
        ce in VALID_EMOTIONS and
        rel in VALID_RELATIONSHIPS
    )


def call_gemini_api(api_key: str, prompt: str, image_path: Path, model: str = "gemini-3.5-flash-lite", timeout: int = 60) -> Dict[str, Any]:
    """Gọi Gemini REST API với JSON mode sau khi xác thực ảnh."""
    img_b64, mime_type = validate_and_encode_image(image_path)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": img_b64
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json"
        }
    }

    headers = {"Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=payload, timeout=timeout)

    if response.status_code == 429:
        raise ResourceWarning(f"HTTP 429 (Rate Limit / Quota Exceeded): {response.text}")
    elif response.status_code == 503:
        raise ConnectionRefusedError(f"HTTP 503 (Model High Demand): {response.text}")
    elif response.status_code != 200:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text}")

    res_json = response.json()
    candidates = res_json.get("candidates", [])
    if not candidates:
        raise RuntimeError(f"Không có candidate nào trả về: {res_json}")

    content_parts = candidates[0].get("content", {}).get("parts", [])
    if not content_parts:
        raise RuntimeError("Candidate không chứa text parts.")

    raw_text = content_parts[0].get("text", "").strip()
    return json.loads(raw_text)


# ============================================================================
# MAIN BATCH PROCESSING PIPELINE (SEPARATE OUTPUT FILE)
# ============================================================================

def run_batch_annotation(
    input_file: Path = DEFAULT_INPUT_FILE,
    output_file: Path = DEFAULT_OUTPUT_FILE,
    model: str = "gemini-3.5-flash-lite",
    delay_sec: float = 4.2,
    max_samples: Optional[int] = None
):
    api_key = get_gemini_api_key()
    if not api_key:
        logger.error("Không tìm thấy GEMINI_API trong .env hoặc biến môi trường!")
        return

    logger.info("=" * 80)
    logger.info("  TIẾN TRÌNH GÁN NHÃN HÀNG LOẠT BẰNG GEMINI VLM (BÓC TÁCH ĐỦ 4 TRƯỜNG)")
    logger.info("=" * 80)
    logger.info(f"  • Model chính:       {model}")
    logger.info(f"  • File Đầu Vào Thô:  {input_file} (Bảo toàn 100%)")
    logger.info(f"  • File Kết Quả VLM:  {output_file} (Tách riêng)")
    logger.info(f"  • Thời gian nghỉ:    {delay_sec}s/request (bảo đảm an toàn hạn ngạch 15 RPM)")
    logger.info("=" * 80)

    if not input_file.exists():
        logger.error(f"File đầu vào {input_file} không tồn tại!")
        return

    # Nếu file output đã có từ đợt chạy trước, nạp để tiếp tục (Resume)
    if output_file.exists():
        logger.info(f"[RESUME] Đọc file kết quả hiện có: {output_file.name}...")
        with open(output_file, "r", encoding="utf-8") as f:
            samples = json.load(f)
    else:
        logger.info(f"[INIT] Khởi tạo file kết quả mới từ {input_file.name}...")
        with open(input_file, "r", encoding="utf-8") as f:
            samples = json.load(f)

    total_samples = len(samples)

    # Lọc các mẫu chưa phân tích đủ 4 trường
    unprocessed_indices = [
        idx for idx, s in enumerate(samples)
        if not is_sample_annotated_with_all_fields(s)
    ]

    completed_count = total_samples - len(unprocessed_indices)
    logger.info(f"Đã hoàn thành trước đó: {completed_count}/{total_samples} mẫu.")
    logger.info(f"Số lượng cần xử lý tiếp: {len(unprocessed_indices)} mẫu.")

    if not unprocessed_indices:
        logger.info("🎉 Tất cả các mẫu đều đã được gán nhãn hoàn chỉnh 100%!")
        return

    if max_samples is not None:
        unprocessed_indices = unprocessed_indices[:max_samples]
        logger.info(f"Chạy giới hạn theo yêu cầu: {len(unprocessed_indices)} mẫu.")

    start_time = time.time()
    processed_in_this_run = 0

    fallback_models = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-3.5-flash"]

    for step_idx, sample_idx in enumerate(unprocessed_indices, 1):
        sample = samples[sample_idx]
        sample_id = sample.get("id", f"SAMPLE_{sample_idx}")
        text_vi = sample.get("text_vi", "")
        text_en = sample.get("text", "")
        rel_img_path = sample.get("image_path", "")

        img_path = ROOT_DIR / rel_img_path
        if not img_path.exists():
            img_path = Path(rel_img_path)

        if not img_path.exists():
            logger.warning(f"[{step_idx}/{len(unprocessed_indices)}] Bỏ qua {sample_id}: Không tìm thấy ảnh tại {img_path}")
            continue

        prompt = build_annotation_prompt(text_vi=text_vi, text_en=text_en)

        max_retries = 3
        success = False

        for attempt in range(1, max_retries + 1):
            # Chọn model (thử model chính, nếu 503 có thể xoay vòng model dự phòng)
            active_model = model if attempt == 1 else fallback_models[(attempt - 1) % len(fallback_models)]
            try:
                result = call_gemini_api(api_key, prompt, img_path, model=active_model, timeout=60)

                # KIỂM TRA CHẶT CHẼ ĐỦ 4 TRƯỜNG (TUYỆT ĐỐI KHÔNG TỰ ÉP VỀ NEUTRAL/CONGRUENT)
                toe = str(result.get("text_only_emotion", "")).strip().lower()
                ioe = str(result.get("image_only_emotion", "")).strip().lower()
                comb_emo = str(result.get("combined_emotion", "")).strip().lower()
                rel_type = str(result.get("relationship_type", "")).strip().upper()
                explanation = str(result.get("explanation", "")).strip()

                invalid_reasons = []
                if toe not in VALID_EMOTIONS:
                    invalid_reasons.append(f"text_only_emotion '{toe}' không thuộc 7 nhãn Ekman")
                if ioe not in VALID_EMOTIONS:
                    invalid_reasons.append(f"image_only_emotion '{ioe}' không thuộc 7 nhãn Ekman")
                if comb_emo not in VALID_EMOTIONS:
                    invalid_reasons.append(f"combined_emotion '{comb_emo}' không thuộc 7 nhãn Ekman")
                if rel_type not in VALID_RELATIONSHIPS:
                    invalid_reasons.append(f"relationship_type '{rel_type}' không thuộc 3 nhóm quan hệ")

                if invalid_reasons:
                    err_msg = "; ".join(invalid_reasons)
                    if attempt < max_retries:
                        logger.warning(f"  [Lần thử {attempt}/{max_retries}] {sample_id} vi phạm schema ({err_msg}). Đang thử lại...")
                        time.sleep(3.0)
                        continue
                    else:
                        # Sau max_retries vẫn lỗi: ĐÁNH CỜ LỖI RÕ RÀNG (KHÔNG chuẩn hóa bậy)
                        logger.error(f"❌ {sample_id} THẤT BẠI VALIDATION sau {max_retries} lần thử: {err_msg}")
                        sample["vlm_proposal"] = {
                            "is_valid": False,
                            "validation_errors": invalid_reasons,
                            "raw_response": result,
                            "text_only_emotion": toe,
                            "image_only_emotion": ioe,
                            "combined_emotion": comb_emo,
                            "relationship_type": rel_type,
                            "explanation": explanation,
                            "model_used": active_model
                        }
                        sample["human_review"] = {
                            "reviewed": False,
                            "decision": "NEEDS_MANUAL_FIX",
                            "final_text_only_emotion": "",
                            "final_image_only_emotion": "",
                            "final_combined_emotion": "",
                            "final_relationship_type": "",
                            "reviewer_notes": f"Cần thẩm định thủ công do VLM vi phạm schema: {err_msg}"
                        }
                        sample["annotation_status"] = "FLAGGED_INVALID_SCHEMA"
                        samples[sample_idx] = sample

                        # Lưu vào file output riêng biệt
                        with open(output_file, "w", encoding="utf-8") as f:
                            json.dump(samples, f, ensure_ascii=False, indent=2)

                        processed_in_this_run += 1
                        success = True
                        break

                # Hợp lệ hoàn toàn: Điền sẵn đề xuất đủ 4 trường vào human_review để người kiểm tra duyệt cực nhanh
                proposal = {
                    "is_valid": True,
                    "text_only_emotion": toe,
                    "image_only_emotion": ioe,
                    "combined_emotion": comb_emo,
                    "relationship_type": rel_type,
                    "explanation": explanation,
                    "model_used": active_model
                }

                sample["vlm_proposal"] = proposal
                sample["human_review"] = {
                    "reviewed": False,
                    "decision": "AGREE",
                    "final_text_only_emotion": toe,
                    "final_image_only_emotion": ioe,
                    "final_combined_emotion": comb_emo,
                    "final_relationship_type": rel_type,
                    "reviewer_notes": ""
                }
                sample["annotation_status"] = "PENDING_HUMAN_REVIEW"
                samples[sample_idx] = sample

                # LƯU NGAY LẬP TỨC VÀO FILE OUTPUT RIÊNG (PHÂN TÍCH ĐẾN ĐÂU LƯU ĐẾN ĐÓ)
                with open(output_file, "w", encoding="utf-8") as f:
                    json.dump(samples, f, ensure_ascii=False, indent=2)

                processed_in_this_run += 1
                completed_total = completed_count + processed_in_this_run
                pct = (completed_total / total_samples) * 100

                logger.info(
                    f"[{completed_total}/{total_samples}] ({pct:.1f}%) "
                    f"Đã lưu {sample_id} | Text: {toe:<8} | Img: {ioe:<8} | Comb: {comb_emo:<8} | Rel: {rel_type:<21} ({active_model})"
                )
                success = True
                break

            except ResourceWarning as rw:
                logger.warning(f"⚠️ {sample_id} gặp 429: {rw}")
                if attempt < max_retries:
                    backoff = 25.0 * attempt
                    logger.info(f"   Đang chờ {backoff}s để hạ nhiệt Rate Limit trước khi thử lại lần {attempt + 1}...")
                    time.sleep(backoff)
                else:
                    logger.error(
                        f"\n🛑 GẶP GIỚI HẠN RATE LIMIT / QUOTA (HTTP 429) TẠI MẪU {sample_id}!\n"
                        f"   • Toàn bộ dữ liệu trước đó ĐÃ ĐƯỢC LƯU AN TOÀN 100% vào: {output_file}\n"
                        f"   • Script tự động dừng tại đây để bảo vệ tài khoản API.\n"
                        f"   • Bạn có thể chạy lại lệnh bất kỳ lúc nào để tiếp tục từ đúng vị trí này!"
                    )
                    return

            except ConnectionRefusedError as cre:
                logger.warning(f"⚠️ {sample_id} gặp 503 ({active_model} high demand). Đang chờ 10s đổi model dự phòng...")
                time.sleep(10.0)

            except Exception as e:
                logger.warning(f"⚠️ {sample_id} (Lần thử {attempt}/{max_retries} với {active_model}): {e}")
                time.sleep(5.0 * attempt)

        if not success:
            logger.error(f"❌ Không thể xử lý {sample_id} sau {max_retries} lần thử. Bỏ qua mẫu này để không kẹt tiến trình.")

        # Nghỉ nhịp giữa các request bình thường để giữ dưới ngưỡng 15 RPM
        if success:
            time.sleep(delay_sec)

    elapsed_m = (time.time() - start_time) / 60
    logger.info("\n" + "=" * 80)
    logger.info(f"🎉 HOÀN THÀNH ĐỢT CHẠY! Đã xử lý thêm {processed_in_this_run} mẫu trong {elapsed_m:.1f} phút.")
    logger.info(f"File kết quả được bảo toàn đầy đủ tại: {output_file}")
    logger.info("=" * 80)


# ============================================================================
# CLI DISPATCHER
# ============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch annotate 1,000 benchmark samples using Gemini VLM")
    parser.add_argument("--model", type=str, default="gemini-3.5-flash-lite", help="Model name (mặc định: gemini-3.5-flash-lite)")
    parser.add_argument("--delay", type=float, default=5, help="Thời gian nghỉ giữa các request tính bằng giây (mặc định: 4.2s)")
    parser.add_argument("--max-samples", type=int, default=None, help="Số lượng mẫu tối đa muốn chạy trong đợt này")
    parser.add_argument("--input", type=str, default=str(DEFAULT_INPUT_FILE), help="File đầu vào thô")
    parser.add_argument("--output", type=str, default=str(DEFAULT_OUTPUT_FILE), help="File lưu kết quả phân tích VLM riêng")
    args = parser.parse_args()

    run_batch_annotation(
        input_file=Path(args.input),
        output_file=Path(args.output),
        model=args.model,
        delay_sec=args.delay,
        max_samples=args.max_samples
    )
