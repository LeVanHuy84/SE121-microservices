# Task Checklist — Phase 2: Context-Aware Guidance

> Status: Ready for Execution  
> Reference: [`SPEC-context-guidance.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/SPEC-context-guidance.md) | [`tasks/plan-phase2.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/tasks/plan-phase2.md)

---

## Slice 2.1: Surface Context Contract & Ingestion
- [x] Define `SurfaceContext` in `ai-chatbot-service/app/modules/chatbot/schemas.py`
- [x] Update `PromptBuilder` to format and inject `[NGỮ CẢNH HIỆN TẠI CỦA NGƯỜI DÙNG]`
- [x] Add unit tests in `tests/test_surface_context.py`
- [x] Add `SurfaceContextDTO` to `packages/shared/src/types/chatbot.types.ts`
- [x] Update `useAssistantChatSession` in `packages/shared/src/hooks/useChatbot.ts` to accept `surface`
- [x] Connect current pathname to `surface` in `AssistantSheet` (Web) and `AssistantChatModal` (Native)

## Slice 2.2: Tool Catalog, Dynamic Tool Router & Groq Tool Calling
- [x] Create `apps/ai-chatbot-service/app/modules/chatbot/tools/` package
- [x] Define multi-domain schemas in `tools/catalog.py` (Social, Groups, Emotions & Music, Posts, Account & Safety)
- [x] Implement `tools/router.py` to dynamically pick max 6 tools based on `surface.screen`
- [x] Implement `tools/dispatcher.py` with forwarded auth headers, timeout, and circuit breaker
- [x] Update `GroqProvider` and `assistant.py` to support tool calling stream loop
- [x] Add unit tests in `tests/test_tool_router.py` and `tests/test_tool_dispatcher.py`

## Slice 2.3: Downstream Service Integrations & Auth Forwarding
- [x] Update `api-gateway` chatbot forwarder to forward `Authorization: Bearer <token>` to chatbot service
- [x] Implement dispatcher handlers for `user-social-service`
- [x] Implement dispatcher handlers for `emotion-intelligence-service` & `music-service`
- [x] Implement dispatcher handlers for `notification-service`
- [x] Implement dispatcher handlers for `content-feed-service` & `group-service`
- [x] Write integration tests with mocked downstream HTTP responses in `tests/test_tool_integration.py`

## Slice 2.4: Mini Cards (`show_card`) Support
- [x] Update `schemas.py` and `@repo/dtos` with `CardAction` & `CardPayload`
- [x] Update `packages/shared/src/types/chatbot.types.ts` and `navigation/actions.ts` to extract `show_card`
- [x] Build Web Mini Card components in `apps/web/components/chatbot/assistant-cards/`
- [x] Build Native Mini Card components in `apps/native/components/chatbot/assistant-cards/`
- [x] Add visual & audio preview tests for Mini Cards

## Slice 2.5: Safety Mutation Testing & Final Verification
- [x] Verify CrisisGuard precedence over Tool Calling (100% guarantee crisis aborts tools)
- [x] Verify Tool permissions: ensure all tools are strictly read-only
- [x] Verify timeout & degraded network handling (graceful polite response when downstream fails)
- [x] Run full test suites: pytest in `ai-chatbot-service` and vitest / typecheck in `social-network-2.0`
