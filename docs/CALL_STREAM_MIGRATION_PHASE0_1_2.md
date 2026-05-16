# Call Media Migration (Phase 0/1/2)

## Phase 0 - Planning & rollback

- Stream-only migration (remove LiveKit from runtime path).
- Keep API contract stable: `issueCallMediaToken` response shape unchanged.
- Rollback path: disable call feature flag if critical issue.

## Phase 1 - Provider abstraction

- `CallMediaService` becomes orchestrator only.
- `CallService` remains domain signaling source of truth.
- Add provider interface:
  - `CallMediaProvider`
  - `issueParticipantToken(context)`

## Phase 2 - Stream backend integration

- Add `StreamMediaProvider` using `@stream-io/node-sdk`.
- Stream provider responsibilities:
  - upsert users on Stream
  - get-or-create call by `callSessionId`
  - issue call-scoped token (`generateCallToken`)
  - map policy to existing response DTO

## Required stream env

- `STREAM_API_KEY`
- `STREAM_API_SECRET`
- `STREAM_CALL_TYPE` (default `default`)
- `STREAM_TOKEN_TTL_SEC` (default `3600`)

## Current status

- Phase 0/1/2 implemented in backend code.
- Build passes for `chat-service` and `api-gateway`.
- LiveKit provider path removed.
