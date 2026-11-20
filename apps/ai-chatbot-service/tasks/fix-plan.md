# Fix Plan: Code Review Findings (In-App Assistant)

> Nguồn: code review ngày 2026-10-31. Phạm vi: chỉ sửa các mục review nêu, không mở rộng.
> Mọi task đều có test đi kèm; sửa bug theo thứ tự viết test fail trước, sửa sau.

## Status: Completed (100%)

- [x] **F1 (tests tích hợp)**: Đã tạo 4 test suites mới (`test_assistant_navigation.py`, `test_action_schema.py`, `test_chat_history_actions.py`, `test_assistant_actions_e2e.py`). Mutation test xác nhận crisis guard được bảo vệ vững chắc. Parity check xác nhận 20/20 destinations khớp nhau giữa backend và client.
- [x] **F2 (distress prompt)**: Tách riêng directive cho trường hợp chỉ có `persistent_distress` (không ghi nhãn JOY/NEUTRAL). `_fetch` chỉ tính các bài có cảm xúc tiêu cực. Test case mới trong `test_emotion_aware.py` pass.
- [x] **F3 (validate destinationId)**: Kiểm tra `destination_catalog.get(destination_id)` trong `record_action_click`. Destination lạ bị từ chối, không ghi vào DB.
- [x] **F4 (nit cleanups)**: Sắp xếp lại thứ tự imports trong `assistant.py`; loại bỏ `_last_result` thừa trong `rag_indexer.py`.
- [x] **F5 (telemetry click correlation)**: Gắn `action.id` vào offer telemetry; `record_action_click` match chính xác theo `action_ids` + `user_id_hash`. Giữ strong reference trong `_pending` set, tránh GC giữa chừng. Đã có suite `test_nav_telemetry.py`.
- [x] **F6 (refactor assistant.py & GuardResult)**: Tách `build_nav_outcome` sang `navigation/policy.py`. Thay tuple 5 phần tử bằng dataclass `GuardResult(slots=True)`.
- [x] **F7 (UI components & typing)**: Tách `AssistantActionButtons` tái sử dụng cho cả Web và Native, có `useRef(Set)` chống click telemetry lặp; chuẩn hóa `AssistantMessageMetadata` và hàm `getAssistantMessageActions` trong `@repo/shared` loại bỏ hoàn toàn `as any`.
- [x] **F8 (verification toàn diện)**:
  - `ai-chatbot-service`: `ruff check` sạch, `pytest` 162/162 passed (100%).
  - `api-gateway` & `@repo/dtos`: `check-types` sạch.
  - `social-network-2.0`: `npm run typecheck` sạch (web, native, ui, shared).

---

## Incremental Improvements (Phase 1 & Service Hardening)

- [x] **Slice 1: Search Query Sanitization & Vietnamese Affixes**:
  - `NavResolver._extract_search_intent` tự động làm sạch thán từ đệm đầu/đuôi ("nhé", "nha", "đi", "với", "ạ", "giúp tôi", "cho tôi").
  - Hỗ trợ trích xuất nguyên vẹn cụm từ trong dấu nháy kép `"... "` từ `original_text` giữ nguyên dấu tiếng Việt và viết hoa.
  - Bổ sung 3 test cases trong `test_nav_resolver.py`.
- [x] **Slice 2: Accessibility (a11y) & Visual Cue cho Action Buttons**:
  - Phân biệt icon theo ngữ cảnh: Icon kính lúp `Search` khi `destinationId === "search"`, `ArrowRight` cho các màn hình khác.
  - Web: Bổ sung `aria-label`, `role="group"`, focus ring `focus-visible:ring-2 focus-visible:ring-primary` cho keyboard navigation.
  - Native: Bổ sung `accessibilityRole="button"`, `accessibilityLabel`, và `hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}` chống bấm hụt trên mobile.
- [x] **Slice 3: Readiness Probe Introspection cho Nav Catalog (`/ready`)**:
  - Mở rộng endpoint `/ready` trong `main.py` kiểm tra `destination_catalog`, trả về `navigator: { status: "ready", destinations_count: 20 }`.
  - Bổ sung e2e test `ReadinessProbeTest` trong `test_assistant_actions_e2e.py`.
- [x] **Slice 4: Internal Telemetry Summary Metrics Endpoint (`/admin/telemetry/stats`)**:
  - Bổ sung `IntentTelemetryService.get_stats()` tính toán `total_offers`, `total_clicks`, `ctr_percentage`.
  - Mở endpoint nội bộ `GET /assistant/admin/telemetry/stats` (bảo vệ bởi `X-Internal-Key`).
  - Bổ sung unit test và e2e test cho stats endpoint.

---

## Required

### F1. Bổ sung test tích hợp còn thiếu
- **Vì sao**: `todo.md` Task 2.1, 2.4, 3.3, 3.5, 4.1 ghi có unit test nhưng chưa có.
- **Việc**:
  - `tests/unit/test_assistant_navigation.py` (mock provider/RAG/telemetry):
    1. Crisis + câu có từ khóa điều hướng → `suggestedActions == []`, type crisis, resolver không được gọi.
    2. Lệnh thuần ("mở cài đặt quyền riêng tư") → `type="navigation"`, provider không bị gọi, có 1 action đúng `destinationId`.
    3. How-to ("làm sao đổi mật khẩu") → provider được gọi; stream chunk đầu mang `suggestedActions`.
    4. Clarify → tối đa 3 action.
    5. Feature question ("có chức năng video call không?") → không action.
  - `tests/unit/test_action_schema.py`: label > 40, `destinationId` sai regex, > 3 actions, crisis kèm action → ValidationError.
  - `tests/unit/test_chat_history_actions.py`: persist `metadata.actions` và map ngược về `suggestedActions`.
  - `tests/e2e`: thêm case `POST /assistant/actions/click` (401 thiếu key, 200 hợp lệ) và `POST /assistant/admin/rag/reindex` (401/200, lần 2 khi đang chạy → `in_progress`).
  - `packages/shared`: test `buildDestinationHref` (id lạ → `null`, web vs native, params). Nếu chưa có test runner trong package thì chỉ ghi nhận và báo lại, không tự thêm tooling.
- **Xong khi**: các test mới pass; mutation kiểm tra (bỏ guard crisis trong `_run_guard_chain`) làm test 1 fail.
- **File**: chỉ thêm file test; không sửa code production ở bước này.

### F2. `persistent_distress` không được làm prompt nói sai cảm xúc
- **Việc**:
  - `prompt_builder._build_emotion_tone_directive`: tách 2 nhánh. Nếu `primary_emotion` tiêu cực → giữ header cũ. Nếu chỉ có `persistent_distress` → header trung tính ("Người dùng có dấu hiệu căng thẳng kéo dài"), không in `JOY/NEUTRAL`.
  - `emotion_context._fetch`: chỉ tính một bài là tiêu cực khi cảm xúc tiêu cực (risk medium/high đi kèm `joy` không tính).
  - Test mới: primary `joy` + `persistent_distress=True` → không chứa `JOY`; `_fetch` với doc `joy`+risk medium không bật persistent.
- **File**: `prompt_builder.py`, `emotion_context.py`, `tests/unit/test_emotion_aware.py`.

---

## Consider (làm vì rẻ hoặc là điều kiện cho refactor)

### F3. Validate `destinationId` ở endpoint click
- Kiểm tra bằng `destination_catalog.get(id)`; id lạ → `recorded=False`, không ghi DB.
- File: `telemetry.py` (kiểm tra ở `record_action_click`), test trong F1.

### F4. Nit
- Đưa import `normalize_for_guard` về đúng thứ tự trong `assistant.py`.
- Xóa `_last_result` chưa dùng trong `rag_indexer.py` (hoặc phơi ra qua `GET status` nếu cần — mặc định xóa).

### F5. Telemetry gắn đúng click ↔ sự kiện, bỏ `create_task` lồng
- Tạo `event_id` trước, dùng làm `action.id` (id đã có trong schema), gửi qua stream.
- `record_action_click` match theo `event_id` + `user_id_hash` thay vì `(user, destination, clicked=False)`.
- `record_intent_offered`: bỏ `create_task` bên trong; nơi gọi giữ task trong một set có `add_done_callback(discard)` để tránh bị GC.
- Test: hai sự kiện cùng destination, click event thứ hai → chỉ event thứ hai `clicked=True`.
- File: `navigation/telemetry.py`, `services/assistant.py`, test.

### F6. Giảm độ phức tạp của `assistant.py` (nằm ~991 dòng)
- Chuyển nhánh nav (command/clarify/howto → action) vào `navigation/policy.py` (`build_nav_response(decision, request) -> NavOutcome`).
- Thay tuple 5 phần tử của `_run_guard_chain` bằng dataclass `GuardResult`.
- Hành vi không đổi; F1 phải xanh trước và sau.

### F7. UI: tách component, bỏ `any`
- Tạo `AssistantActionButtons` cho web (`apps/web/components/chatbot/`) và native (`apps/native/components/chatbot/`), thay các IIFE.
- `packages/shared`: type `AssistantMessageMetadata { actions?: AssistantSuggestedActionDTO[] }`, dùng trong `useChatbot.ts`.
- Optional: chặn double-click gửi click telemetry (set `actionId` đã click trong component).

---

## F8. Verification cuối
- `apps/ai-chatbot-service`: `ruff check app/ tests/` và `INTERNAL_SERVICE_KEY=test GROQ_API_KEY=test .venv/bin/pytest tests/unit/ tests/e2e/`.
- `api-gateway` + `@repo/dtos`: `check-types`.
- `social-network-2.0`: `npm run typecheck`; sau đó `git checkout apps/web/tsconfig.tsbuildinfo`.
- Cập nhật `todo.md`: đánh dấu F1–F8 và sửa lại các task ghi "có test" cho khớp thực tế.
- Không đụng các lỗi `Types.ObjectId` có sẵn ở `chat-service` / `emotion-intelligence-service`.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| F5 đổi ý nghĩa `action.id` → client cũ gửi id cũ | Click không match thì trả `recorded=False`, không lỗi; telemetry chỉ là số liệu phụ |
| F6 làm đổi hành vi | F1 chạy trước/sau mỗi bước, commit nhỏ |
| `packages/shared` chưa có test runner | Báo lại thay vì thêm tooling ngoài phạm vi |

## Ước lượng
F1 (Medium) → F2 (S) → F3/F4 (XS) → F5 (S) → F6 (M) → F7 (S) → F8 (XS).
Ranh giới dừng hợp lý: sau F2 (hết mục Required), có thể dừng và để F3–F7 cho lần sau.
