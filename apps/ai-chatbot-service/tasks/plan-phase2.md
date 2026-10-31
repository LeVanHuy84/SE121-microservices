# Plan Phase 2: Context-Aware Guidance (`context-guidance`)

> **Focus**: Surface Context Ingestion + Multi-domain Tool Registry + Dynamic Tool Routing + Mini Cards  
> **Source Specification**: [`SPEC-context-guidance.md`](file:///home/vinh-co/projects/SE121-microservices/apps/ai-chatbot-service/SPEC-context-guidance.md)  
> **Constraint Reminder**: Strictly Read-Only. CrisisGuard always executes first. User identity strictly forwarded from API Gateway.

---

## Architecture & Work Breakdown Structure

### Slice 2.1 — Surface Context Contract & Ingestion
- **Goal**: Allow FE to pass active screen and entity information; BE parses, validates, and injects into system prompt.
- **Files**:
  - `apps/ai-chatbot-service/app/modules/chatbot/schemas.py`: Add `SurfaceContext` model.
  - `apps/ai-chatbot-service/app/modules/chatbot/prompt_builder.py`: Add `_build_surface_context_directive()`.
  - `packages/shared/src/types/chatbot.types.ts`: Add `SurfaceContextDTO`.
  - `packages/shared/src/hooks/useChatbot.ts`: Support sending `surface` in `sendMessage`.
  - `apps/web/components/chatbot/assistant-sheet.tsx`: Auto-detect current pathname and map to `surface`.
  - `apps/native/components/chatbot/assistant-chat-modal.tsx`: Auto-detect current pathname and map to `surface`.

### Slice 2.2 — Tool Registry, Dynamic Tool Router & Groq Tool Calling
- **Goal**: Multi-domain read-only tool catalog with context-aware tool routing (max 6 active tools/turn).
- **Files**:
  - `apps/ai-chatbot-service/app/modules/chatbot/tools/catalog.py`: Full schema catalog across 5 domains (Social, Groups, Emotions & Music, Posts, Account & Safety).
  - `apps/ai-chatbot-service/app/modules/chatbot/tools/router.py`: `ToolRouter` dynamically selecting relevant tools based on `surface.screen`.
  - `apps/ai-chatbot-service/app/modules/chatbot/tools/dispatcher.py`: Async dispatcher calling internal microservices via Gateway/HTTP with user bearer token and timeout handling.
  - `apps/ai-chatbot-service/app/modules/chatbot/assistant.py`: Wire tool calling into the streaming loop.

### Slice 2.3 — Downstream Microservice Client Integrations
- **Goal**: Implement HTTP calls from `ai-chatbot-service` to downstream microservices with circuit breakers.
- **Targets**:
  - `user-social-service`: `/social/requests`, `/friends/recommend`, `/social/relationship/:id`, `/social/blocked`.
  - `notification-service`: `/notifications/unread-count`, `/notifications`.
  - `emotion-intelligence-service`: `/emotions/user-summary`, `/emotions/trends`, mindfulness tips.
  - `music-service`: `/musics/recommendations-by-emotion`.
  - `content-feed-service`: `/posts/my-overview`, `/posts/:id/comments-summary`, `/posts/saved`.
  - `group-service`: `/groups/:id`, `/groups/my-groups`, `/groups/invites`, `/groups/recommendations`.
  - `moderation-service`: `/moderations/my-history`.

### Slice 2.4 — Rich Mini Cards Output (`show_card`)
- **Goal**: Support structured card rendering in chat for rich insights.
- **Files**:
  - `apps/ai-chatbot-service/app/modules/chatbot/schemas.py`: Add `CardAction` & `CardPayload`.
  - `packages/shared/src/types/chatbot.types.ts`: Add `AssistantCardAction`.
  - `apps/web/components/chatbot/assistant-cards/`: Implement React Mini Cards (EmotionSummaryCard, MusicCard, FriendRequestsCard, GroupCard, NotificationCard).
  - `apps/native/components/chatbot/assistant-cards/`: Implement Native Mini Cards.

### Slice 2.5 — Verification, Safety Mutation Tests & Telemetry
- **Goal**: Validate CrisisGuard precedence, tool isolation, error handling, performance.
- **Tests**:
  - Unit tests for `SurfaceContext`, `ToolRouter` and `PromptBuilder`.
  - Mocked e2e tests for tool execution and fallback on service failure.
  - Crisis mutation test: assert tools NEVER run during crisis messages.
