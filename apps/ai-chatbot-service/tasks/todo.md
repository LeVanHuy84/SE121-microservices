# Task List: In-App AI Assistant (Navigator Phase 1) & Service Hardening

> **Kế hoạch tham chiếu**: [`plan.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/tasks/plan.md)  
> **Tài liệu đặc tả**:
> - [`CAPABILITY-MAP-in-app-assistant.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/CAPABILITY-MAP-in-app-assistant.md)
> - [`SPEC-assistant-action-contract.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/SPEC-assistant-action-contract.md)
> - [`SPEC-nav-discovery.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/SPEC-nav-discovery.md)
> - [`SPEC-ai-chatbot.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/SPEC-ai-chatbot.md)

---

## Phase 1: Nền tảng & Decoupling Service (Core Hardening)

- [x] **Task 1.1: Tạo `app.core.messaging` quản lý Kafka Producer & Outbox tập trung**
  - **Description**: Tạo module `app/core/messaging.py` chứa singleton accessor cho Kafka Producer và Outbox Repository dùng chung cho toàn service.
  - **Acceptance criteria**:
    - [x] Cung cấp các hàm `get_kafka_producer()`, `set_kafka_producer()`, `get_outbox_repo()`, `set_outbox_repo()`.
    - [x] Hoàn toàn không import từ `app.modules.analysis` hay `app.modules.chatbot`.
  - **Verification**: `ruff check app/core/messaging.py`
  - **Dependencies**: None.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/core/messaging.py`
  - **Estimated scope**: Small (1 file).

- [x] **Task 1.2: Refactor `assistant.py` và `main.py` loại bỏ import từ `analysis.lifespan`**
  - **Description**: Sửa `assistant.py` (`_emit_crisis_event`) để lấy dependencies từ `app.core.messaging`, khởi tạo và dọn dẹp kết nối trong lifespan chính của service.
  - **Acceptance criteria**:
    - [x] `grep -rn "analysis.lifespan" apps/ai-chatbot-service/app/modules/chatbot/` trả về rỗng.
    - [x] Cơ chế fallback Outbox khi Kafka lỗi vẫn hoạt động nguyên vẹn.
  - **Verification**: `INTERNAL_SERVICE_KEY=test GROQ_API_KEY=test .venv/bin/pytest tests/unit/test_assistant_service.py -v`
  - **Dependencies**: Task 1.1.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/services/assistant.py`
    - `apps/ai-chatbot-service/app/main.py`
    - `apps/ai-chatbot-service/app/modules/analysis/lifespan.py`
  - **Estimated scope**: Small (3 files).

- [x] **Task 1.3: Graceful cancellation & Semaphore guard trong `execute_stream`**
  - **Description**: Bao bọc generator SSE stream trong khối `try...finally` để luôn giải phóng `_LLM_SEMAPHORE` khi client disconnect, bắt `asyncio.CancelledError` và lưu lại partial history nếu đã có text stream.
  - **Acceptance criteria**:
    - [x] Semaphore luôn được giải phóng khi generator bị close/abort.
    - [x] Không có unhandled task exception hay leak connection.
  - **Verification**: Unit test giả lập stream abort kiểm tra việc release semaphore.
  - **Dependencies**: Task 1.2.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/services/assistant.py`
  - **Estimated scope**: Small (1 file).

- [x] **Task 1.4: Retry exponential backoff cho `GroqProvider`**
  - **Description**: Thêm cơ chế retry tối đa 2 lần với exponential backoff khi gặp mã lỗi 429 hoặc 503 từ Groq API.
  - **Acceptance criteria**:
    - [x] Tự động retry khi gặp lỗi Rate Limit hoặc Network timeout.
    - [x] Không retry đối với lỗi 400 hoặc 401.
  - **Verification**: Unit test mock provider ném 429 lần 1 và trả về token lần 2.
  - **Dependencies**: None.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/providers/groq_provider.py`
  - **Estimated scope**: Small (1 file).

## Checkpoint 1: Foundation Clean & Robust
- [x] 108 bài test hiện tại pass 100%.
- [x] Không còn import chéo domain, streaming an toàn và không leak semaphore.

---

## Phase 2: Chuẩn hóa Giao thức Hành động (Action Contract)

- [x] **Task 2.1: Cập nhật Pydantic Schemas trong `ai-chatbot-service`**
  - **Description**: Cập nhật `schemas.py` bổ sung discriminated union `NavigateAction`, `NavigatePayload` và thêm `"navigation"` vào `AssistantResponseType`.
  - **Acceptance criteria**:
    - [x] `destinationId` tuân theo format regex regex `^[a-z]+(\.[a-z_]+)*$`.
    - [x] Button label tối đa 40 ký tự.
    - [x] `suggestedActions` giới hạn tối đa 3 phần tử.
    - [x] Crisis turn bắt buộc có `suggestedActions=[]`.
  - **Verification**: Unit test schema validation cho valid và invalid navigate action payloads.
  - **Dependencies**: None.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/schemas.py`
  - **Estimated scope**: Small (1 file).

- [x] **Task 2.2: Cập nhật `@repo/dtos`**
  - **Description**: Cập nhật `assistant-response.dto.ts` để đồng bộ cấu trúc `AssistantSuggestedActionDto` với payload `destinationId` và `params`.
  - **Acceptance criteria**:
    - [x] `npm run build` trong `packages/dtos` biên dịch thành công không lỗi type.
  - **Verification**: `npm --workspace=@repo/dtos run build`
  - **Dependencies**: Task 2.1.
  - **Files likely touched**:
    - `packages/dtos/src/chat/assistant/assistant-response.dto.ts`
  - **Estimated scope**: Small (1 file).

- [x] **Task 2.3: Đồng bộ types trong `packages/shared`**
  - **Description**: Cập nhật `packages/shared/src/types/chatbot.types.ts` để định nghĩa `AssistantNavigateAction` và union type `AssistantSuggestedActionDTO`.
  - **Acceptance criteria**:
    - [x] `npm run typecheck` trong `packages/shared` pass sạch sẽ.
  - **Verification**: `cd /home/vinh-co/projects/social-network-2.0 && npm run typecheck`
  - **Dependencies**: Task 2.2.
  - **Files likely touched**:
    - `packages/shared/src/types/chatbot.types.ts`
  - **Estimated scope**: Small (1 file).

- [x] **Task 2.4: Lưu trữ và phục hồi `metadata.actions` trong MongoDB Chat History**
  - **Description**: Đảm bảo `chat_history.py` lưu trường `actions` vào `metadata.actions` và khi gọi `get_history` (phục vụ `GET /assistant/chat-history/me`) map ngược lại vào `suggestedActions`.
  - **Acceptance criteria**:
    - [x] Tin nhắn lưu trong Mongo chứa `metadata.actions`.
    - [x] Endpoint lấy lịch sử chat trả về đúng danh sách actions để client hiển thị lại các nút.
  - **Verification**: Unit test trong `test_chat_history.py` kiểm tra persist và retrieve actions.
  - **Dependencies**: Task 2.1.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/repositories/chat_history.py`
  - **Estimated scope**: Small (1 file).

## Checkpoint 2: Synchronized Cross-Repo Contract
- [x] Types đồng bộ 100% giữa Python, NestJS Gateway DTOs và Next.js/React Native shared types.
- [x] History lưu trữ và khôi phục được action buttons.

---

## Phase 3: Backend Navigation Catalog, Resolver & Telemetry

- [x] **Task 3.1: Định nghĩa `destinations.yaml` và `catalog.py`**
  - **Description**: Tạo file cấu hình `destinations.yaml` chứa toàn bộ danh mục màn hình của Sentimeta (không có route admin) và class `DestinationCatalog` tải + validate cấu trúc lúc khởi động.
  - **Acceptance criteria**:
    - [x] Chứa đầy đủ các màn: home, friends (requests, suggestions, blocked), groups (explore, my_groups, invites), conversations, notifications, emotions, search, profile.me, settings (privacy, notifications, activity, moderation_history, support, privacy_policy).
    - [x] Ném lỗi rõ ràng lúc khởi động nếu catalog có entry sai cú pháp.
  - **Verification**: Unit test kiểm tra khởi tạo `DestinationCatalog`.
  - **Dependencies**: None.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/navigation/destinations.yaml`
    - `apps/ai-chatbot-service/app/modules/chatbot/navigation/catalog.py`
  - **Estimated scope**: Medium (2 files).

- [x] **Task 3.2: Xây dựng `resolver.py` (NavResolver)**
  - **Description**: Xây dựng bộ giải định hướng thuần túy (deterministic, không I/O): chuẩn hóa tiếng Việt bỏ dấu, tính điểm tương đồng từ khóa/synonym, phân loại ý định (command vs howto vs clarify), và trích xuất search query (qua CommunityGuard).
  - **Acceptance criteria**:
    - [x] Thời gian xử lý < 5ms.
    - [x] Trả về danh sách tối đa 3 `NavMatch` sắp xếp theo điểm số giảm dần.
  - **Verification**: Unit test với các mẫu câu tiếng Việt đa dạng (có dấu, không dấu, viết hoa/thường).
  - **Dependencies**: Task 3.1.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/navigation/resolver.py`
  - **Estimated scope**: Medium (1 file).

- [x] **Task 3.3: Tích hợp `NavResolver` vào `assistant.py`**
  - **Description**: Đấu nối `NavResolver` vào chuỗi xử lý của `RespondCommand`: chạy sau `CrisisGuard` và `CommunityGuard`. Nếu là lệnh điều hướng rõ ràng, short-circuit trả về `type="navigation"` với câu trả lời mẫu (không gọi LLM, p95 < 150ms). Nếu là câu hỏi how-to, gọi RAG + LLM như thường nhưng đính kèm action buttons.
  - **Acceptance criteria**:
    - [x] Crisis check luôn chạy trước: nếu có crisis, tuyệt đối không xuất hiện navigation actions.
    - [x] Streaming SSE phát `suggestedActions` ngay tại chunk đầu tiên.
  - **Verification**: Unit test `test_assistant_service.py` kiểm tra luồng pure navigation và how-to navigation.
  - **Dependencies**: Task 3.2, Task 2.1.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/services/assistant.py`
  - **Estimated scope**: Medium (1 file).

- [x] **Task 3.4: Xây dựng service lưu trữ Intent Telemetry**
  - **Description**: Tạo `telemetry.py` lưu lượt kích hoạt navigation vào collection `assistant_intent_events` trong MongoDB (gồm: userId hash, destinationIds, resolverPath, normalizedTokens, timestamp; TUYỆT ĐỐI không lưu raw text tin nhắn).
  - **Acceptance criteria**:
    - [x] Ghi bất đồng bộ, không làm chậm luồng phản hồi chat.
    - [x] Tuân thủ nguyên tắc Data Minimization.
  - **Verification**: Unit test kiểm tra ghi log intent telemetry.
  - **Dependencies**: None.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/navigation/telemetry.py`
  - **Estimated scope**: Small (1 file).

- [x] **Task 3.5: Endpoint Gateway & Internal ghi nhận Click Telemetry**
  - **Description**: Thêm endpoint `POST /v1/assistant/actions/click` ở `api-gateway` và `POST /assistant/actions/click` ở AI service để ghi nhận hành vi user bấm vào nút điều hướng.
  - **Acceptance criteria**:
    - [x] Được bảo vệ bởi Clerk auth trên Gateway và `X-Internal-Key` trên AI service.
    - [x] Cập nhật trạng thái `clicked: True` cho event tương ứng.
  - **Verification**: Test endpoint bằng TestClient / Supertest.
  - **Dependencies**: Task 3.4.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/router.py`
    - `apps/api-gateway/src/modules/chatbot/chatbot.controller.ts`
    - `apps/api-gateway/src/modules/chatbot/chatbot.service.ts`
  - **Estimated scope**: Medium (3 files).

- [x] **Task 3.6: Xây dựng bộ dữ liệu đánh giá `nav_eval_vi.jsonl`**
  - **Description**: Tạo tập dữ liệu kiểm thử gồm ít nhất 120 câu tiếng Việt với các nhãn destination kỳ vọng, bao gồm cả các câu không liên quan (negative samples).
  - **Acceptance criteria**:
    - [x] Top-1 accuracy đạt ≥ 85%.
    - [x] Top-3 accuracy đạt ≥ 95%.
    - [x] False positive (câu không phải navigation bị gán nút) ≤ 5%.
  - **Verification**: `INTERNAL_SERVICE_KEY=test .venv/bin/pytest tests/unit/test_nav_resolver.py`
  - **Dependencies**: Task 3.2.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/tests/fixtures/nav_eval_vi.jsonl`
    - `apps/ai-chatbot-service/tests/unit/test_nav_resolver.py`
  - **Estimated scope**: Medium (2 files).

## Checkpoint 3: Backend Navigation Verified
- [x] Toàn bộ bài test của NavResolver và eval-set pass chuẩn xác.
- [x] Pure navigation phản hồi tức thì mà không tiêu tốn token LLM.

---

## Phase 4: Tích hợp Giao diện Client (Web & Native)

- [x] **Task 4.1: Xây dựng Destination Allowlist & Helper trong `packages/shared`**
  - **Description**: Tạo `packages/shared/src/navigation/destinations.ts` định nghĩa bảng ánh xạ `{ web, native }` và hàm `buildDestinationHref(destinationId, params, platform)`.
  - **Acceptance criteria**:
    - [x] Nếu `destinationId` không nằm trong danh mục, trả về `null`.
    - [x] Hỗ trợ render linh hoạt theo nền tảng (Web Next.js URL vs Native Expo route).
  - **Verification**: Unit test trong `packages/shared` cho `buildDestinationHref`.
  - **Dependencies**: Task 2.3.
  - **Files likely touched**:
    - `packages/shared/src/navigation/destinations.ts`
    - `packages/shared/src/navigation/index.ts`
  - **Estimated scope**: Small (2 files).

- [x] **Task 4.2: Render Action Buttons trên Web (`assistant-sheet.tsx`)**
  - **Description**: Cập nhật `assistant-sheet.tsx` hiển thị các nút điều hướng bên dưới tin nhắn trợ lý. Khi user bấm nút: gọi API click telemetry, đóng khung chat (sheet) và kích hoạt `router.push`.
  - **Acceptance criteria**:
    - [x] Nút bấm hiển thị đẹp, rõ ràng, tối đa 3 nút.
    - [x] Bấm nút chuyển hướng ngay sang trang tương ứng và ghi nhận click.
  - **Verification**: `npm run build --workspace web`
  - **Dependencies**: Task 4.1, Task 3.5.
  - **Files likely touched**:
    - `apps/web/components/chatbot/assistant-sheet.tsx`
  - **Estimated scope**: Small (1 file).

- [x] **Task 4.3: Render Action Buttons trên Native (`assistant-message-list.tsx`)**
  - **Description**: Cập nhật giao diện chatbot Native hiển thị nút hành động và gọi `router.push` của Expo Router khi user chạm vào.
  - **Acceptance criteria**:
    - [x] Hiển thị nút bấm thân thiện với mobile.
    - [x] Chạm vào nút điều hướng tới đúng màn hình hoặc màn hình gần nhất.
  - **Verification**: Type-check trong workspace Native.
  - **Dependencies**: Task 4.1, Task 3.5.
  - **Files likely touched**:
    - `apps/native/components/chatbot/assistant-message-list.tsx`
  - **Estimated scope**: Small (1 file).

## Checkpoint 4: Seamless End-to-End User Experience
- [x] Web và Mobile đều hiển thị nút điều hướng chuẩn xác, bấm là chuyển trang.
- [x] Telemetry ghi nhận đầy đủ tỷ lệ click thực tế.

---

## Phase 5: Mở rộng RAG Dynamic Indexing & Emotion Arc

- [x] **Task 5.1: Xây dựng `RagIndexerService` & Endpoint Hot Re-index**
  - **Description**: Đóng gói script indexing vào service có async lock và mở endpoint nội bộ `POST /assistant/admin/rag/reindex` chạy nền.
  - **Acceptance criteria**:
    - [x] Cho phép trigger re-index tài liệu RAG qua API mà không làm gián đoạn hệ thống.
  - **Verification**: Test endpoint bằng TestClient.
  - **Dependencies**: None.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/services/rag_indexer.py`
    - `apps/ai-chatbot-service/app/modules/chatbot/router.py`
  - **Estimated scope**: Medium (2 files).

- [x] **Task 5.2: Bổ sung chỉ số xu hướng cảm xúc vào `EmotionContextService` & `PromptBuilder`**
  - **Description**: Thêm cờ `persistent_distress` vào `EmotionSnapshot` và cập nhật chỉ dẫn xoa dịu cảm xúc trong prompt khi user có tâm trạng tiêu cực kéo dài.
  - **Acceptance criteria**:
    - [x] Prompt được tinh chỉnh tăng tính an ủi và kỹ thuật thở/grounding khi phát hiện trầm buồn kéo dài.
  - **Verification**: Unit test kiểm tra prompt sinh ra.
  - **Dependencies**: None.
  - **Files likely touched**:
    - `apps/ai-chatbot-service/app/modules/chatbot/services/emotion_context.py`
    - `apps/ai-chatbot-service/app/modules/chatbot/services/prompt_builder.py`
  - **Estimated scope**: Small (2 files).

- [x] **Task 5.3: Kiểm tra toàn diện CI Quality Gates (Type-check, Lint, Test)**
  - **Description**: Chạy toàn bộ test suites và linters của cả 2 repo (`SE121-microservices` và `social-network-2.0`).
  - **Acceptance criteria**:
    - [x] 0 lỗi type-check, 0 lỗi lint, 100% tests pass (phạm vi các file thay đổi; lỗi mongoose typing sẵn có ở `chat-service`/`emotion-intelligence-service` nằm ngoài kế hoạch, không sửa).
  - **Verification**:
    - `SE121-microservices`: `npm run check-types && npm run lint` và pytest unit/e2e.
    - `social-network-2.0`: `npm run typecheck && npm run lint`.
  - **Dependencies**: All previous tasks.
  - **Files likely touched**: N/A
  - **Estimated scope**: XS.

## Checkpoint 5: Production Ready
- [x] Toàn bộ các tiêu chí trong capability map và các bản spec được thỏa mãn đầy đủ.
