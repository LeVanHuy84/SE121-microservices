# Task Checklist — Phase 3: Context-Aware Execution (`context-execution`)

> Status: Completed (100% Slices 3.1 - 3.5)  
> Reference: [`tasks/plan-phase3.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/tasks/plan-phase3.md)

---

## Slice 3.1: Action Protocol & Contract Expansion
- [x] Define `ProposeAction`, `ActionExecutionRequest`, `ActionExecutionResponse` in `schemas.py`
- [x] Add `AssistantProposeActionDTO`, `ExecuteActionInputDTO`, `ExecuteActionResultDTO` to `@repo/shared`
- [x] Add `isProposeAction` and `getAssistantProposeActions` helper in `packages/shared/src/navigation/actions.ts`
- [x] Build & typecheck `@repo/shared`

## Slice 3.2: Execution Engine, Allowlist Registry & Redis Idempotency
- [x] Create `ActionRegistry` with strict allowlist in `apps/ai-chatbot-service/app/modules/chatbot/actions/registry.py`
- [x] Implement `ActionExecutorService` with Redis idempotency check in `apps/ai-chatbot-service/app/modules/chatbot/actions/executor.py`
- [x] Expose `POST /assistant/actions/execute` in `router.py`
- [x] Forward `POST /actions/execute` in `api-gateway` controller & service with bearer token
- [x] Add unit tests for `ActionExecutorService` and idempotency replay in `tests/test_action_execution.py`

## Slice 3.3: LLM Proposal Synthesis
- [x] Add proposal prompt guidelines in `prompt_builder.py`
- [x] Implement proposal extraction & `idempotencyKey` generation in `assistant.py`
- [x] Add unit tests for proposal generation in `tests/test_assistant_proposals.py`

## Slice 3.4: Frontend Action Confirmation Cards (Web & Mobile)
- [x] Add `executeAction` method in `packages/shared/src/api/services/chatbot.service.ts`
- [x] Build `ActionConfirmationCard` component for Web in `apps/web/components/chatbot/action-confirmation-card.tsx`
- [x] Embed confirmation card in `apps/web/components/chatbot/assistant-sheet.tsx`
- [x] Build `ActionConfirmationCard` component for Native in `apps/native/components/chatbot/action-confirmation-card.tsx`
- [x] Embed confirmation card in `apps/native/components/chatbot/assistant-message-list.tsx`

## Slice 3.5: Safety Mutation Testing & Final Verification
- [x] Verify CrisisGuard suppresses all action proposals during crisis messages
- [x] Verify rapid double-click idempotency handling
- [x] Run full pytest suite in `ai-chatbot-service` (181 passed, 52 subtests passed)
- [x] Run monorepo typecheck & build in `social-network-2.0` (0 errors, build successful)

## Slice 3.6: Action Protocol Expansion & Server-Driven Dynamic Cards
- [x] Expand allowlisted actions to 10 total: add `decline_friend_request`, `unfriend_user`, `block_user`, `react_post`
- [x] Add Server-Driven metadata (`category`, `is_destructive`) to `ActionDefinition` and `ProposeActionPayload`
- [x] Implement proposal synthesis & intent detection for 4 new actions in `assistant.py`
- [x] Implement execution handlers in `executor.py` mapped to downstream endpoints (`/social/decline`, `/social/remove`, `/social/block`, `/reactions`)
- [x] Update `@repo/shared` types with `AssistantActionCategory` and open union `(string & {})` for forward-compatible actions
- [x] Update Web & Native `ActionConfirmationCard` to dynamically render icons by category and destructive styling by `isDestructive`
- [x] Add unit tests for registry, execution, and proposal synthesis (20/20 passed)
- [x] Run monorepo typecheck (100% clean)
