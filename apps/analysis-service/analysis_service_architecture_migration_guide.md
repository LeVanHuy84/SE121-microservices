# Analysis Service – Architecture & Migration Guide

## 1. Mục tiêu tài liệu

Tài liệu này mô tả:
- Kiến trúc đề xuất cho **Analysis Service (AI-integrated Social Network)**
- Nguyên tắc phân tách layer (Domain / Application / Infrastructure)
- Cách **migration code cũ sang cấu trúc mới** với rủi ro thấp

Mục tiêu chính:
- Giữ nguyên behavior hiện tại
- Giảm coupling giữa AI logic và business logic
- Chuẩn bị cho mở rộng (thêm model, thêm rule, scale async)

---

## 2. Kiến trúc tổng thể (Target Architecture)

### 2.1. Sơ đồ layer

```
API (FastAPI)
   ↓
Application / Orchestration Services
   ↓
Domain Services (Business Logic)
   ↓
Infrastructure (DB, Kafka, Redis, AI Models)
```

### 2.2. Nguyên tắc chính

- **API layer**: chỉ validate + delegate
- **Application layer**: điều phối luồng xử lý (flow)
- **Domain layer**: thuần logic, không side-effect
- **Infrastructure layer**: DB, Kafka, Redis, model AI

---

## 3. Cấu trúc thư mục đề xuất

```
services/
├── domain/
│   ├── emotion/
│   │   ├── emotion_analyzer.py
│   │   ├── emotion_normalizer.py
│   │   ├── preset_mapper.py
│   │   └── emotion_types.py
│   ├── moderation/
│   │   └── content_moderator.py
│   └── risk/
│       └── risk_scorer.py
│
├── orchestration/
│   ├── analysis_flow_service.py
│   └── handle_event_service.py
│
├── ai/
│   ├── model_loader.py
│   ├── text_emotion/
│   └── image_emotion/
```

---

## 4. Phân loại lại code hiện tại

### 4.1. Domain Services (thuần logic)

Đặc điểm:
- Không import Kafka / Mongo / Redis
- Không async side-effect
- Dễ unit test

| File cũ | Vị trí mới |
|------|-----------|
| services/emotion_analyzer.py | services/domain/emotion/emotion_analyzer.py |
| utils/emotion_normalizer.py | services/domain/emotion/emotion_normalizer.py |
| services/risk_scorer.py | services/domain/risk/risk_scorer.py |
| services/content_moderator.py | services/domain/moderation/content_moderator.py |

---

### 4.2. Application / Orchestration Services

Đặc điểm:
- Gọi nhiều domain service
- Có DB / Kafka / Redis
- Đại diện cho 1 use-case

| File cũ | Vị trí mới |
|------|-----------|
| services/handle_event_service.py | services/orchestration/handle_event_service.py |
| (new) | services/orchestration/analysis_flow_service.py |

---

### 4.3. AI / Model layer

Đặc điểm:
- Phụ thuộc model cụ thể
- Có thể swap model trong tương lai

| File cũ | Vị trí mới |
|------|-----------|
| services/model_loader.py | services/ai/model_loader.py |
| services/text_emotion/* | services/ai/text_emotion/* |
| services/image_emotion/* | services/ai/image_emotion/* |

---

### 4.4. Utils (chỉ giữ cross-domain)

Chỉ giữ:
- Stateless helper
- Không business rule

| Giữ lại | Lý do |
|------|------|
| helpers.py | string, time, format |
| image_downloader.py | infra helper |
| download_result.py | IO helper |

❌ Không để emotion, mapping nghiệp vụ trong utils.

---

## 5. Ví dụ refactor cụ thể

### 5.1. Risk Scorer (Domain)

```python
# services/domain/risk/risk_scorer.py
class RiskScorer:
    def calculate(self, emotions: list[str]) -> int:
        score = 0
        if 'angry' in emotions:
            score += 30
        if 'sad' in emotions:
            score += 20
        return score
```

Không DB, không Kafka, không async side-effect.

---

### 5.2. Analysis Flow Service (Application)

```python
# services/orchestration/analysis_flow_service.py
class AnalysisFlowService:
    def __init__(self, emotion_analyzer, risk_scorer, outbox_repo):
        self.emotion_analyzer = emotion_analyzer
        self.risk_scorer = risk_scorer
        self.outbox_repo = outbox_repo

    async def analyze_text(self, text: str):
        emotions = await self.emotion_analyzer.analyze(text)
        risk = self.risk_scorer.calculate(emotions)

        await self.outbox_repo.save_analysis_result(
            emotions=emotions,
            risk=risk,
        )

        return {"emotions": emotions, "risk": risk}
```

---

## 6. Chiến lược Migration (an toàn, từng bước)

### Bước 1: Di chuyển file (không đổi logic)
- Move file sang folder mới
- Fix import
- Không refactor code

### Bước 2: Cô lập side-effect
- Remove Kafka / DB khỏi domain service
- Đưa về orchestration

### Bước 3: Thu gọn utils
- Di chuyển business logic ra domain
- Utils chỉ còn helper thuần

### Bước 4: Update API layer
- Controller chỉ gọi orchestration service

---

## 7. Anti-pattern cần tránh

- Domain service gọi Kafka
- Utils chứa business rule
- Controller xử lý emotion / risk
- AI model trả về format gắn chặt UI

---

## 8. Lợi ích đạt được

- Thay model AI không ảnh hưởng business
- Test domain logic độc lập
- Flow rõ ràng, dễ debug
- Phù hợp event-driven & async processing

---

## 9. Ghi chú cho đồ án / báo cáo

Có thể mô tả kiến trúc là:

> “Hệ thống áp dụng phân tách Domain Service và Application Service nhằm cô lập logic nghiệp vụ phân tích cảm xúc khỏi hạ tầng AI và messaging, giúp hệ thống dễ mở rộng và thay thế mô hình AI trong tương lai.”

---

**End of document**

