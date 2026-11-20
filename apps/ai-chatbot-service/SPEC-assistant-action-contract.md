# Spec: `assistant-action-contract`

> Module of [CAPABILITY-MAP-in-app-assistant.md](./CAPABILITY-MAP-in-app-assistant.md) · Depends on: — · Status: **Draft – awaiting review**

## Assumptions

1. We **evolve** the existing `suggestedActions` field (already present in Python `schemas.py`, `@repo/dtos` `AssistantSuggestedActionDto`, and `packages/shared` `AssistantSuggestedActionDTO`) instead of adding a new field. It is currently always `[]`, so a typed shape is backward compatible for every consumer.
2. Only `navigate` is **emitted** in Phase 1. `propose_action` / `action_result` are reserved names in the union so Phase 2/3 don't break the contract, but the BE must not emit them yet.
3. The FE (web and native) is the only party that performs navigation. It validates every action against the shared allowlist in `packages/shared` (defense in depth). Navigation happens **only on user click**, never automatically.

## Objective

A typed, versioned action protocol between `ai-chatbot-service` → `api-gateway` → web, so the assistant can return machine-actionable buttons next to its text reply. Success = a response carrying a `navigate` action renders as a button in [assistant-sheet.tsx](file:///home/vinh-co/projects/social-network-2.0/apps/web/components/chatbot/assistant-sheet.tsx) and clicking it routes the user, for both `/respond` and `/respond-stream`, live and from history.

## Contract

```ts
// packages/shared/src/types/chatbot.types.ts  (mirrored in @repo/dtos + Python Pydantic)
export type AssistantActionType = 'navigate' | 'propose_action' | 'action_result'; // only 'navigate' emitted in Phase 1

export interface AssistantNavigateAction {
  type: 'navigate';
  id: string;                 // per-response unique id (uuid) – used for click telemetry
  label: string;              // Vietnamese button text, ≤ 40 chars
  payload: {
    destinationId: string;    // catalog id, e.g. "settings.privacy" – FE maps id → route
    params?: Record<string, string>; // only whitelisted params of that destination (e.g. { q, type } for search)
  };
}

export type AssistantSuggestedActionDTO = AssistantNavigateAction; // union grows in later modules
```

Rules:
- `payload` never contains a raw URL/path. The FE builds the URL from `destinationId` + `params`. Unknown `destinationId` → button is not rendered (logged once to console in dev).
- Max **3** actions per response.
- `AssistantResponseType` gains `"navigation"`: a turn whose primary output is actions (short templated reply, LLM optional).
- **Streaming**: actions are delivered on the **first** SSE `chunk` event (same as `sources` today). Non-streaming: on the response body.
- **Crisis turns** (`type="crisis"`) must have `suggestedActions=[]`.
- **History**: actions are stored in the existing `chat_messages.metadata.actions` (no new top-level field) and returned by `GET /assistant/chat-history/me` so buttons re-render.

## Tech Stack

Python/Pydantic v2 (discriminated union on `type`), NestJS `@repo/dtos` (class-validator), TypeScript in `packages/shared`, React 19 / Next.js 15 in web.

## Commands

```bash
# SE121-microservices
cd apps/ai-chatbot-service && INTERNAL_SERVICE_KEY=test GROQ_API_KEY=test .venv/bin/pytest tests/unit tests/e2e -q && .venv/bin/ruff check app tests
cd ../.. && npm run build && npm run check-types && npm run lint
# social-network-2.0
npm run typecheck && npm run lint && npm run build --workspace web
```

## Project Structure (files touched)

```
SE121-microservices/
  apps/ai-chatbot-service/app/modules/chatbot/schemas.py          # Pydantic union + "navigation" response type
  apps/ai-chatbot-service/app/modules/chatbot/repositories/chat_history.py  # persist/read metadata.actions
  packages/dtos/src/chat/assistant/assistant-response.dto.ts      # typed DTO
  apps/api-gateway/src/modules/chatbot/*                          # pass-through only (verify no field stripping)
social-network-2.0/
  packages/shared/src/types/chatbot.types.ts                      # TS union
  packages/shared/src/navigation/destinations.ts                  # destinationId → { web, native } route builders (allowlist)
  apps/web/components/chatbot/assistant-sheet.tsx                 # render buttons, router.push on click
  apps/native/components/chatbot/assistant-message-list.tsx       # render buttons, expo-router push on click
```

## Code Style

```python
class NavigatePayload(BaseModel):
    destinationId: str = Field(pattern=r"^[a-z]+(\.[a-z_]+)*$")
    params: dict[str, str] = Field(default_factory=dict)

class NavigateAction(BaseModel):
    type: Literal["navigate"] = "navigate"
    id: str = Field(default_factory=lambda: str(uuid4()))
    label: str = Field(max_length=40)
    payload: NavigatePayload

AssistantSuggestedAction = Annotated[NavigateAction, Field(discriminator="type")]
```

## Testing Strategy

- **Python unit**: schema accepts valid navigate action; rejects path-like `destinationId`, >40-char label, >3 actions; crisis response has no actions.
- **Python e2e**: `/v1/assistant/respond-stream` first chunk carries `suggestedActions`; history endpoint returns `metadata.actions`.
- **FE**: typecheck; unit test for `buildDestinationHref(id, params)` (unknown id → `null`, non-whitelisted params dropped); manual check in the sheet.

## Boundaries

- **Always**: keep the field name `suggestedActions`; validate on both BE (Pydantic) and FE (allowlist).
- **Ask first**: renaming fields, adding new top-level fields to `chat_messages`, changing SSE event names.
- **Never**: emit raw URLs; emit `propose_action`/`action_result` in this module; let the gateway transform/strip the field.

## Success Criteria

1. All three type definitions (Python, `@repo/dtos`, `packages/shared`) describe the same `navigate` shape; existing 108 tests still pass.
2. A fixture response with one `navigate` action renders a button on **web and native**; click routes to the correct page on each platform (native falls back to the nearest screen or hides the button when the destination has no native screen).
3. Reloading the sheet shows the same buttons from history.
4. A crafted action with `destinationId: "admin.dashboard"` or an unknown id renders nothing.

## Open Questions

1. ~~Auto-navigate~~ **Resolved**: Phase 1 never auto-navigates. Navigation happens only when the user clicks the button. May be revisited (auto-navigate on explicit command) once telemetry shows top-1 accuracy > 95 %.
