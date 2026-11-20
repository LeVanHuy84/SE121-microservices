# Plan Phase 3: Context-Aware Execution (`context-execution`)

> **Focus**: Propose-Confirm-Execute Flow + Idempotency Store + Action Confirmation Cards + Core Write Mutations (Friendship, Groups, Notifications)  
> **Constraint Reminder**: **Zero Silent Mutations**. The chatbot never performs a write mutation without explicit user confirmation via an interactive card. User identity strictly forwarded from API Gateway. CrisisGuard always executes first.

---

## Architecture & Work Breakdown Structure

### Slice 3.1 — Action Protocol & Contract Expansion
- **Goal**: Expand Action Contract across BE and FE with `propose_action`, `confirm_action`, and `action_result`.
- **Files**:
  - `apps/ai-chatbot-service/app/modules/chatbot/schemas.py`: Add `ProposeAction`, `ActionExecutionRequest`, `ActionExecutionResponse`.
  - `packages/shared/src/types/chatbot.types.ts`: Add `AssistantProposeActionDTO`, `ExecuteActionInputDTO`, `ExecuteActionResultDTO`.
  - `packages/shared/src/navigation/actions.ts`: Add `isProposeAction` validator & `getAssistantProposeActions` helper.

### Slice 3.2 — Execution Engine, Allowlist Registry & Redis Idempotency
- **Goal**: Safe backend execution endpoint with server-side allowlist and Redis-backed replay protection.
- **Files**:
  - `apps/ai-chatbot-service/app/modules/chatbot/actions/registry.py`: Strict allowlist of executable actions (`send_friend_request`, `accept_friend_request`, `cancel_friend_request`, `join_group`, `leave_group`, `mark_all_notifications_read`).
  - `apps/ai-chatbot-service/app/modules/chatbot/actions/executor.py`: `ActionExecutorService` checking 15m Redis TTL for `idempotencyKey` and calling downstream services via `GatewayHttpClient`.
  - `apps/ai-chatbot-service/app/modules/chatbot/router.py`: Expose `POST /assistant/actions/execute`.
  - `apps/api-gateway/src/modules/chatbot/chatbot.controller.ts` & `chatbot.service.ts`: Forward `POST /actions/execute` with user bearer token.

### Slice 3.3 — LLM Proposal Synthesis
- **Goal**: When user asks to execute an action (e.g. "Gửi kết bạn cho Nam", "Tham gia nhóm", "Đọc hết thông báo"), the LLM proposes an action with a confirmation card instead of attempting immediate mutation.
- **Files**:
  - `apps/ai-chatbot-service/app/modules/chatbot/services/assistant.py`: Detect mutation intent and attach `ProposeAction` with generated `idempotencyKey`.
  - `apps/ai-chatbot-service/app/modules/chatbot/prompt_builder.py`: Instruct LLM on proposal protocol.

### Slice 3.4 — Frontend Action Confirmation Cards (Web & Mobile)
- **Goal**: Interactive confirmation cards allowing 1-click confirmation or cancellation with live status.
- **Files**:
  - `apps/web/components/chatbot/assistant-confirmation-card.tsx`: Web confirmation card with `[Xác nhận]` (loading spinner) and `[Hủy]`.
  - `apps/web/components/chatbot/assistant-sheet.tsx`: Integrate confirmation card into chat stream.
  - `apps/native/components/chatbot/assistant-confirmation-card.tsx`: Native confirmation card with Uniwind & feedback.
  - `apps/native/components/chatbot/assistant-message-list.tsx`: Integrate confirmation card into Native FlashList.
  - `packages/shared/src/api/services/chatbot.service.ts`: Add `executeAction` API call.

### Slice 3.5 — Safety, Mutation Testing & Verification
- **Goal**: Verify crisis safety, idempotency deduplication, and full regression testing.
- **Tests**:
  - `apps/ai-chatbot-service/tests/test_action_execution.py`: Test allowlist, execution handlers, Redis idempotency cache, duplicate request prevention.
  - Test CrisisGuard ensures zero proposals during crisis turns.
  - Full CI check: pytest on BE, typecheck & build on FE.
