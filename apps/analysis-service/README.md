# Analysis Service

`analysis-service` là một microservice dùng để phân tích **cảm xúc** từ **văn bản** và **hình ảnh**, với khả năng tổng hợp (fusion) để đưa ra cảm xúc cuối cùng của một bài viết hoặc bình luận.

---

## 🔹 Các model chính

1. **Text Emotion**:
   - Model: `visolex/phobert-emotion` (PhoBERT fine-tuned)
   - Nhiệm vụ: Phân loại cảm xúc từ văn bản tiếng Việt.

2. **Image Emotion**:
   - Model: `FER` (version `22.4.0`) sử dụng PyTorch backend
   - Nhiệm vụ: Phân tích cảm xúc từ khuôn mặt trong ảnh.

3. **EmotionAnalyzer**:
   - Fusion kết hợp kết quả từ **text** và **image**.
   - Logic:
     - Nếu không có khuôn mặt hoặc nhiều khuôn mặt → chỉ dùng text.
     - Nếu confidence của image thấp → ưu tiên text.
     - Adaptive fusion theo confidence để tính final score.

---

## 🔹 API

### 1. Phân tích cảm xúc từ **văn bản**

```http
POST /api/text/sentiment
Content-Type: application/json

{
    "text": "Thức ăn bị thiu mà vẫn bày ra cho khách, thật đáng ghê tởm."
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "dominant_emotion": "disgust",
    "emotion_scores": {
      "anger": 0.0766,
      "disgust": 0.6821,
      "joy": 0.0018,
      "fear": 0.2332,
      "neutral": 0.002,
      "sadness": 0.0031,
      "surprise": 0.0014
    }
  }
}
```

---

### 2. Phân tích cảm xúc từ **hình ảnh**

```http
POST /api/image/analyze_images
Content-Type: application/json

{
    "images": ["https://res.cloudinary.com/dyxdfvpgi/image/upload/v1764599378/hinh-anh-nu-cuoi-dep-7_ui8l61.jpg"]
}
```

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "url": "https://res.cloudinary.com/dyxdfvpgi/image/upload/v1764599378/hinh-anh-nu-cuoi-dep-7_ui8l61.jpg",
      "face_count": 1,
      "dominant_emotion": "joy",
      "emotion_scores": {
        "anger": 0.01,
        "disgust": 0.01,
        "fear": 0.04,
        "joy": 0.83,
        "sadness": 0.06,
        "surprise": 0.02,
        "neutral": 0.04
      }
    }
  ]
}
```

---

### 3. Phân tích **tổng hợp bài viết / comment** (text + image)

```http
POST /api/emotion/analyze
Content-Type: application/json

{
    "userId": "abc13d",
    "targetId": "abcf",
    "targetType": "POST",
    "content": "Nắng xinh lung linh",
    "imageUrls": ["https://res.cloudinary.com/dyxdfvpgi/image/upload/v1764599378/hinh-anh-nu-cuoi-dep-7_ui8l61.jpg"]

}
```

**Response**:

```json
{
  "userId": "abc13d",
  "targetId": "abcf",
  "targetType": "POST",
  "text_emotion": {
    "dominant_emotion": "joy",
    "emotion_scores": {
      "anger": 0.0003,
      "disgust": 0.0003,
      "joy": 0.9961,
      "fear": 0.0008,
      "neutral": 0.0005,
      "sadness": 0.0006,
      "surprise": 0.0014
    }
  },
  "image_emotions": [
    {
      "url": "https://res.cloudinary.com/dyxdfvpgi/image/upload/v1764599378/hinh-anh-nu-cuoi-dep-7_ui8l61.jpg",
      "face_count": 1,
      "dominant_emotion": "joy",
      "emotion_scores": {
        "anger": 0.01,
        "disgust": 0.01,
        "joy": 0.83,
        "fear": 0.04,
        "neutral": 0.04,
        "sadness": 0.06,
        "surprise": 0.02
      }
    }
  ],
  "final_emotion": "joy",
  "final_scores": {
    "anger": 0.0047088468819632655,
    "disgust": 0.0047088468819632655,
    "joy": 0.9206036303577951,
    "fear": 0.018617195872517457,
    "neutral": 0.018453552131015755,
    "sadness": 0.02759850632577278,
    "surprise": 0.009854077074597737
  }
}
```

---

## 🔹 Cấu hình môi trường

- Sử dụng Python **3.11.6** hoặc **3.11.9**.
- Các biến môi trường được load từ `.env` (tham khảo `.env.example`).

---

## 🔹 Hướng dẫn cài đặt

```bash
# 1. Clone repo
git clone <repo_url>
cd analysis-service

# 2. Tạo virtual environment
py -m venv venv

# 3. Kích hoạt venv
npm run venv

# 4. Cài thư viện
npm run install

# 5. Chạy server FastAPI
npm run dev
```

> Lưu ý:
>
> - Server sử dụng **FastAPI 0.115.2** + **Uvicorn 0.32.0**
> - Các thư viện ML/AI: `torch 2.2.2`, `torchvision 0.17.2`, `transformers 4.41.2`, `fer 22.4.0`, `tensorflow 2.14.0`
> - Hỗ trợ xử lý hình ảnh: `opencv-python 4.9.0.80`, `pillow 10.3.0`

---

## 🔹 File & Service chính

- `app/services/model_loader.py`: load model PhoBERT + FER, warmup FER, phân tích image.
- `app/services/emotion_detector.py`: phân tích hình ảnh, normalize score.
- `app/services/text_classifier.py`: phân tích cảm xúc văn bản.
- `app/services/emotion_analyzer.py`: tổng hợp text + image → final emotion.

---

## 🔹 Ghi chú

- Hệ thống có thể xử lý nhiều URL hình ảnh.
- Khi fusion, nếu nhiều khuôn mặt xuất hiện → ưu tiên text-only.
- Singleton `model_loader` đảm bảo không load lại model nhiều lần.
- Có thể mở rộng logic fusion hoặc lưu kết quả vào DB trong tương lai.
