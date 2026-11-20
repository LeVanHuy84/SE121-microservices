# Implementation Plan: In-App AI Assistant (Navigator Phase 1) & Service Hardening

> **Dựa trên**:
> - [`CAPABILITY-MAP-in-app-assistant.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/CAPABILITY-MAP-in-app-assistant.md) (Approved)
> - [`SPEC-assistant-action-contract.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/SPEC-assistant-action-contract.md) (Approved)
> - [`SPEC-nav-discovery.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/SPEC-nav-discovery.md) (Approved)
> - [`SPEC-ai-chatbot.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/SPEC-ai-chatbot.md) (Approved)
>
> **Workflow**: Spec-Driven Development (Phase 2: Plan & Phase 3: Tasks)  
> **Phạm vi**: Gộp toàn bộ các hạng mục nền tảng (Service Hardening) và Module Phase 1: Navigation & Discovery cho cả Backend, Web và Native.

---

## 1. Overview (Tổng quan kiến trúc)

Kế hoạch này kết hợp hai trục mục tiêu:
1. **Kiến trúc nền tảng (Service Hardening)**: Tách ranh giới domain giữa `chatbot` và `analysis`, giải phóng coupling trong `app.core.messaging`, tăng cường resilience cho SSE streaming và retry LLM.
2. **Trợ lý định hướng (Navigator Phase 1)**: Xây dựng giao thức hành động (`suggestedActions`), bộ catalog định tuyến màn hình chuẩn xác, bộ giải định hướng thuần túy (NavResolver) không tốn chi phí LLM, tích hợp hiển thị nút điều hướng trên Web & Native, cùng hệ thống ghi nhận intent & click telemetry.

---

## 2. Architecture Decisions (Quyết định kiến trúc)

- **ADR-1: Decoupling Shared Messaging**: Đưa Kafka Producer và Outbox Repository vào `app.core.messaging`. Cả `chatbot` và `analysis` đều nhận dependency từ đây, chấm dứt import chéo ngược domain.
- **ADR-2: Action Contract Discriminated Union**: Tái sử dụng trường `suggestedActions` (hiện luôn rỗng `[]`), định nghĩa kiểu `NavigateAction` mang `destinationId` (không mang raw URL) và các params an toàn. Hỗ trợ hiển thị nút trên cả SSE streaming lẫn history message.
- **ADR-3: Deterministic NavResolver (Zero-LLM Command Routing)**: Lệnh điều hướng rõ ràng ("mở cài đặt quyền riêng tư", "xem lời mời kết bạn") được giải quyết trực tiếp qua keyword/synonym matcher với độ trễ < 5ms, trả về `type="navigation"` với câu trả lời mẫu mà không cần gọi LLM, đạt p95 < 150ms.
- **ADR-4: Multi-step Navigation with RAG**: Các câu hỏi "làm sao để..." vẫn đi qua RAG và LLM để sinh các bước hướng dẫn, nhưng đính kèm nút điều hướng tới màn hình tương ứng.
- **ADR-5: Cross-Platform Destination Mapping**: `packages/shared/src/navigation/destinations.ts` là nguồn chân lý duy nhất phía client ánh xạ `destinationId` thành URL trên Web và route trên Expo Native.
- **ADR-6: Intent & Click Telemetry**: Lưu ý định user vào MongoDB `assistant_intent_events` (không lưu raw text để bảo vệ quyền riêng tư). Cung cấp endpoint Gateway `POST /assistant/actions/click` để ghi nhận tỷ lệ click.

---

## 3. Phased Task List & Checkpoints

### Giai đoạn 1: Nền tảng & Decoupling Service (Core Hardening)
- [ ] **Task 1.1**: Tạo `app.core.messaging` quản lý Kafka Producer & Outbox Repository tập trung.
- [ ] **Task 1.2**: Refactor `assistant.py` và `main.py` loại bỏ hoàn toàn import từ `analysis.lifespan`.
- [ ] **Task 1.3**: Graceful cancellation & Semaphore guard trong `execute_stream` cho SSE.
- [ ] **Task 1.4**: Retry exponential backoff cho `GroqProvider` khi gặp mã 429/503.
- [ ] **Checkpoint 1**: 108 bài test hiện tại pass 100%, không còn import chéo, streaming an toàn.

### Giai đoạn 2: Chuẩn hóa Giao thức Hành động (Action Contract)
- [ ] **Task 2.1**: Cập nhật Pydantic schemas trong `ai-chatbot-service` (`NavigateAction`, `NavigatePayload`, `"navigation"` response type).
- [ ] **Task 2.2**: Cập nhật `@repo/dtos` trong `packages/dtos/src/chat/assistant/assistant-response.dto.ts`.
- [ ] **Task 2.3**: Đồng bộ types trong `packages/shared/src/types/chatbot.types.ts`.
- [ ] **Task 2.4**: Cập nhật lưu trữ `metadata.actions` trong `chat_history.py` để hỗ trợ hiển thị lại nút khi tải lịch sử chat.
- [ ] **Checkpoint 2**: Type-check qua cả 3 workspace (`ai-chatbot-service`, `dtos`, `shared`), schema contract khớp 100%.

### Giai đoạn 3: Backend Navigation Catalog, Resolver & Telemetry
- [ ] **Task 3.1**: Tạo `destinations.yaml` và `catalog.py` tải và xác thực catalog lúc startup.
- [ ] **Task 3.2**: Xây dựng `resolver.py` (NavResolver) xử lý chuẩn hóa tiếng Việt, matching synonym, nhận diện lệnh và trích xuất search query.
- [ ] **Task 3.3**: Tích hợp `NavResolver` vào `assistant.py` (chạy sau CrisisGuard/CommunityGuard, short-circuit pure navigation không gọi LLM).
- [ ] **Task 3.4**: Xây dựng service ghi nhận telemetry `assistant_intent_events` (anonymized hash, không raw message).
- [ ] **Task 3.5**: Thêm endpoint nội bộ và gateway `POST /assistant/actions/click` phục vụ click tracking.
- [ ] **Task 3.6**: Viết bộ test eval-set `nav_eval_vi.jsonl` (≥ 120 câu) kiểm tra độ chính xác (top-1 ≥ 85%, top-3 ≥ 95%).
- [ ] **Checkpoint 3**: Backend navigation hoàn chỉnh, pure nav p95 < 150ms, eval test đạt chuẩn.

### Giai đoạn 4: Tích hợp Giao diện Client (Web & Native)
- [ ] **Task 4.1**: Tạo `packages/shared/src/navigation/destinations.ts` định nghĩa bảng ánh xạ `{ web, native }` và helper `buildDestinationHref`.
- [ ] **Task 4.2**: Render action buttons trong `apps/web/components/chatbot/assistant-sheet.tsx`, xử lý click điều hướng và gửi telemetry.
- [ ] **Task 4.3**: Render action buttons trong `apps/native/components/chatbot/assistant-message-list.tsx`, xử lý `router.push` Expo và click telemetry.
- [ ] **Checkpoint 4**: Trải nghiệm mượt mà trên cả Web và Mobile, bấm nút chuyển màn hình chính xác.

### Giai đoạn 5: Mở rộng RAG Dynamic Indexing & Emotion Arc
- [ ] **Task 5.1**: Tạo `RagIndexerService` và endpoint nội bộ `POST /assistant/admin/rag/reindex` cho phép cập nhật tài liệu hot.
- [ ] **Task 5.2**: Tích hợp chỉ số xu hướng cảm xúc (`persistent_distress`) trong `EmotionContextService` và `PromptBuilder`.
- [ ] **Task 5.3**: Kiểm tra toàn diện Lint, Typecheck và Test suite toàn bộ repo.
- [ ] **Checkpoint 5 (Hoàn thành)**: Toàn bộ hệ thống sẵn sàng production.

---

## 4. Risks & Mitigations

| Rủi ro | Mức độ | Biện pháp giảm thiểu |
|---|---|---|
| Resolver nhận diện nhầm câu trò chuyện thông thường thành lệnh điều hướng | Trung bình | Đặt ngưỡng điểm tự tin cao (`score >= 0.85`), chỉ xuất hiện tối đa 3 nút, non-nav false positive ≤ 5% được bảo đảm qua eval test. |
| Người dùng yêu cầu điều hướng trong trạng thái khủng hoảng tâm lý | Cao | CrisisGuard luôn được đánh giá ĐẦU TIÊN; mọi intent điều hướng bị chặn hoàn toàn khi phát hiện tín hiệu khủng hoảng. |
| Đường dẫn màn hình thay đổi ở Web hoặc Native làm hỏng nút bấm | Thấp | Kiểm tra qua contract allowlist ở client. Nếu `destinationId` không tồn tại, UI tự động ẩn nút và ghi warning, không bao giờ crash app. |

---

## 5. Theo dõi tiến độ

Xem danh sách checklist chi tiết từng file tại [`todo.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/tasks/todo.md).
