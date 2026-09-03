# Pipeline Thử nghiệm VLM Tích hợp 100% (Unified Multimodal Pipeline)

> **Vị trí thư mục:** `evaluation/image-experiment/`  
> **Mô hình VLM Thử nghiệm:** `llama-3.2-11b-vision-instruct` (via Groq LPUs API)  
> **Môi trường Python:** Sử dụng Virtual Environment tại `evaluation/.venv`  

---

## 🎯 Đặc điểm Kiến trúc Tích hợp 100%

Hệ thống **loại bỏ hoàn toàn FER và CLIP** trong main production pipeline, chuyển **100% nhiệm vụ phân tích hình ảnh cho VLM**:

1. **Phân tích Cảm xúc Multi-label (7 Nhãn Ekman):** Trả về `emotion_scores` cho 7 nhãn (`joy`, `sadness`, `anger`, `fear`, `disgust`, `surprise`, `neutral`).
2. **Kiểm duyệt Nội dung (Content Moderation):** Tích hợp kiểm duyệt NSFW, Graphic Violence, Self-harm signals trực tiếp trong cùng 1 request VLM (không cần model CLIP hay kiểm duyệt riêng).
3. **Phát hiện Mâu thuẫn (Sarcasm/Irony):** Nhận diện khi Status viết tích cực gượng ép nhưng Hình ảnh thể hiện sự u uất/tự hại.
4. **Hỗ trợ Bài đăng Nhiều Ảnh (Native Multi-Image):** Gửi mảng danh sách $N$ ảnh trong 1 single request payload duy nhất.

---

## 🚀 Hướng dẫn Chạy Thử nghiệm

### Bước 1: Kích hoạt venv trong thư mục `evaluation`
Mở PowerShell tại gốc dự án và chạy:
```powershell
.\evaluation\.venv\Scripts\Activate.ps1
```

### Bước 2: Thiết lập Groq API Key
Cấu hình API Key của Groq (Lấy key miễn phí tại [Groq Console](https://console.groq.com/keys)):
```powershell
$env:GROQ_API_KEY="gsk_your_groq_api_key_here"
```

### Bước 3: Chạy Pipeline Thử nghiệm VLM Groq Tích hợp
```powershell
python .\evaluation\image-experiment\vlm_groq_pipeline.py
```

---

## 📊 Kết quả JSON Output mẫu thu được từ `vlm_groq_pipeline.py`:

```json
{
  "modality": "UNIFIED_MULTIMODAL_VLM",
  "primary_emotion": "sadness",
  "secondary_emotions": [
    "fear"
  ],
  "final_confidence": 0.88,
  "intensity": "moderate",
  "emotion_scores": {
    "joy": 0.02,
    "sadness": 0.85,
    "anger": 0.1,
    "fear": 0.42,
    "disgust": 0.05,
    "surprise": 0.0,
    "neutral": 0.08
  },
  "is_sarcasm_or_conflict": true,
  "conflict_explanation": "Status viết 'Mọi thứ vẫn ổn', nhưng hình ảnh thể hiện căn phòng tối tăm u uất và dấu hiệu thương tích.",
  "content_moderation": {
    "is_flagged": true,
    "flagged_categories": [
      "SELF_HARM_SIGNALS"
    ],
    "confidence": 0.94,
    "reason": "Phát hiện dấu hiệu u uất nặng và tổn thương."
  },
  "mental_health_risk_level": "high",
  "suggested_action": "TRIGGER_PROACTIVE_CHECKIN",
  "latency_seconds": 0.642,
  "model_used": "llama-3.2-11b-vision-instruct"
}
```
