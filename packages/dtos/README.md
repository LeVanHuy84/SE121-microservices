# @repo/dtos

## Overview
Centralized Data Transfer Objects (DTOs), request/response interfaces, payload validation schemas, and enum definitions shared across all microservices and the API Gateway in the SE121 backend ecosystem.

## Interface
- `chat`: Chat message, conversation, active call, and presence DTOs (`./src/chat`).
- `social`: Posts, comments, reactions, and share event DTOs (`./src/social`).
- `feed`: Personal feed queries, snapshot streams, and trending feeds (`./src/feed`).
- `user`: User profile, profile recommendation, and user update DTOs (`./src/user`).
- `group`: Community group core management, membership, logs, and reports (`./src/group`).
- `emotion`: Emotion analysis details, user emotion history, and admin feedback (`./src/emotion`).
- `moderation`: Content appeal, moderation status query, and audit logs (`./src/moderation`).
- `search`: Search query DTOs for users, groups, posts, and music tracks (`./src/search`).
- `music`: Music track metadata and recommendation query models (`./src/music`).
- `pagination`: Standard cursor and offset pagination DTOs (`PageResponseDto`, `CursorPaginationResponse`).
- `notification`: In-app and push notification request contracts (`./src/notification`).
- `log`: Microservice audit logging and system request tracking DTOs (`./src/log`).

## Invariants
- Field constraints must utilize `class-validator` and `class-transformer` decorators where applicable to enforce runtime validation at controller boundaries.
- Pagination response envelopes must strictly adhere to `PageResponseDto` or `CursorPaginationResponse`.
- Enumerations (`Role`, `PostPrivacy`, `ReactionType`, `EmotionType`, `CallStatus`) serve as the source of truth across service boundaries.

## Side Effects
- Runtime payload validation and property transformation on incoming request payloads.

## Verification
- Run: `npm run check-types`
