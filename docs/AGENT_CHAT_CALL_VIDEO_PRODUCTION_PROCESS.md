# AGENT Process: Phát Triển Call/Video Call Production Trên SE121 Chat Service

## 1) Mục tiêu

Tài liệu này là quy trình chuẩn để agent triển khai tính năng call/video call trên `SE121-microservices` theo chuẩn production:

- Không phá vỡ luồng chat hiện tại.
- Chịu tải multi-instance.
- Có khả năng quan sát, chống lỗi, rollback.
- Có checklist rõ ràng cho từng phase.

## 2) Hiện trạng chat-service (đã rà soát)

### 2.1 Kiến trúc hiện tại

- `api-gateway`:
  - REST cho chat.
  - Socket.IO Gateway namespace `/chat`.
  - Nhận event từ Redis Stream consumer và broadcast WS.
- `chat-service`:
  - Xử lý nghiệp vụ conversation/message.
  - MongoDB là nguồn dữ liệu chính.
  - Redis cache + presence.
  - Publish event vào Redis Stream `chat:events` qua outbox/publisher.

### 2.2 Điểm mạnh đang có thể tái sử dụng

- Mô hình event-driven sẵn có (`chat:events` + consumer).
- `syncVersion` để giảm out-of-order.
- Presence + active conversation tracking để tối ưu push/realtime.
- Pattern transaction (Mongoose session) ở service conversation/message.

### 2.3 Khoảng trống cho call/video call

- Chưa có domain call session (schema + state machine).
- Chưa có signaling event chuẩn (offer/answer/ice).
- Chưa có timeout logic cho missed/reconnect timeout.
- Chưa tích hợp media infrastructure (SFU/TURN).

## 3) Kiến trúc đích production

### 3.1 Tách 3 lớp rõ ràng

1. **Signaling layer**: `api-gateway` WebSocket + `chat-service` call domain.  
2. **Media layer**: SFU (khuyến nghị LiveKit) + TURN (coturn).  
3. **Persistence/observability layer**: Mongo + Redis + metrics/logs/traces.

### 3.2 Nguyên tắc

- Media stream không đi qua app service.
- App chỉ xử lý signaling + authz + lifecycle.
- Mọi chuyển trạng thái call phải idempotent và có điều kiện trạng thái trước.

## 4) Dữ liệu và schema bắt buộc

## 4.1 Collection mới: `call_sessions`

Trường bắt buộc:

- `_id`
- `conversationId`
- `initiatorId`
- `participants[]`
- `type` (`audio` | `video`)
- `status` (`initiated` | `ringing` | `accepted` | `ended` | `rejected` | `missed` | `cancelled`)
- `startedAt`, `endedAt`, `endReason`
- `ringTimeoutAt`, `reconnectDeadlineAt`
- `syncVersion`
- `createdAt`, `updatedAt`

Index bắt buộc:

- `{ conversationId: 1, createdAt: -1 }`
- `{ participants: 1, createdAt: -1 }`
- `{ status: 1, ringTimeoutAt: 1 }`
- `{ status: 1, reconnectDeadlineAt: 1 }`

### 4.2 Chỉnh `conversation`

- Thêm `activeCallId` (nullable)
- Thêm `lastCallAt` (nullable)

Mục tiêu: query nhanh conversation nào đang call và badge UI.

### 4.3 Bắt buộc tạo message hiển thị call/video call trong timeline

Call/video call phải được lưu thành message hệ thống để hiển thị trong cuộc trò chuyện.

Chỉnh `message` schema:

- Thêm `messageType`:
  - `text` (mặc định)
  - `system_call`
- Thêm `systemMeta` (nullable), ví dụ:
  - `kind`: `call`
  - `callId`
  - `callType`: `audio | video`
  - `callStatus`: `initiated | accepted | rejected | missed | cancelled | ended`
  - `endedReason`
  - `durationSec`
  - `actorId` (người thao tác cuối cùng: end/reject/cancel)

Rule hiển thị:

- Khi `createCall`: tạo 1 `system_call` message kiểu "Cuộc gọi bắt đầu".
- Khi `reject/missed/cancelled/ended`: update cùng message đó hoặc tạo message kết thúc riêng (chọn 1 chiến lược nhất quán).
- Luôn cập nhật `conversation.lastMessage` để timeline/sort hoạt động đúng.

## 5) Contract realtime và API

### 5.1 WS events server -> client

- `call.invite`
- `call.ringing`
- `call.accepted`
- `call.rejected`
- `call.ended`
- `call.signal`
- `message.new` (system call message)
- `message.updated` (khi cập nhật trạng thái call trong message)

### 5.2 WS/REST action client -> server

- `createCall`
- `acceptCall`
- `rejectCall`
- `endCall`
- `sendCallSignal`

### 5.3 Rule validate

- User phải thuộc `conversation.participants`.
- Chỉ 1 active call/conversation (trừ khi business cho phép khác).
- Transition hợp lệ theo state machine.

## 6) State machine chuẩn

- `initiated -> ringing`
- `ringing -> accepted | rejected | missed | cancelled`
- `accepted -> ended`

Quy tắc:

- `accept` chỉ hợp lệ từ `ringing`.
- `reject` chỉ hợp lệ từ `ringing`.
- `end` hợp lệ từ `accepted` (hoặc `ringing` nếu caller cancel).

## 7) Phase triển khai cho agent

### Phase A - Foundation

- Tạo DTO/enum/config timeout.
- Tạo schema + module call.
- Wire vào `chat-service`.
- Viết migration/index script (nếu có cơ chế migration nội bộ).

Definition of Done:

- Build pass.
- Có unit test schema + mapping DTO.

### Phase B - Call domain service

- Implement service methods:
  - `createCall`
  - `acceptCall`
  - `rejectCall`
  - `endCall`
  - `getCallById`
- Dùng transaction + optimistic control (`syncVersion` hoặc conditional update).
- Publish `call.*` events vào stream.
- Tạo/cập nhật `system_call` message đồng bộ với trạng thái call.
- Đảm bảo update `conversation.lastMessage` khi call message thay đổi.

Definition of Done:

- Unit test transition/race condition pass.
- Không có duplicate state transition khi retry.
- Timeline hiển thị đúng message call/video call ở mọi nhánh (accepted/rejected/missed/ended).

### Phase C - Gateway integration

- Mở REST endpoint qua `api-gateway`.
- Mở WS signaling event qua `chat.gateway`.
- Fanout theo room `user:{id}` và `conversation:{id}`.
- Validate DTO + authz guard.

Definition of Done:

- E2E 2 user gọi/nhận cuộc gọi thành công.
- Event phát đúng đối tượng.

### Phase D - Timeout + reliability

- Cron/scheduler:
  - `ringTimeout` -> `missed`
  - `reconnectDeadline` -> `ended(timeout)`
- Dọn state Redis TTL.
- Push incoming call cho user offline/background.

Definition of Done:

- Không còn call treo.
- Missed/timeout được ghi nhận đúng.

### Phase E - Media infra production

- Tích hợp LiveKit (hoặc mediasoup).
- Cấp token theo `callSessionId`, `participant`.
- Cấu hình TURN bắt buộc.
- Fallback audio-only khi network xấu.

Definition of Done:

- Test qua NAT/restrictive network thành công.
- Theo dõi được setup latency/drop rate.

### Phase F - Hardening + rollout

- Rate limit anti-spam call.
- Alert + dashboard:
  - Answer rate
  - Setup latency p50/p95
  - Drop rate
  - Reconnect success
- Runbook sự cố + kế hoạch rollback.

Definition of Done:

- Staging soak test ổn định.
- Có canary rollout và rollback path.

## 8) Testing strategy bắt buộc

### 8.1 Unit

- Transition matrix đầy đủ.
- Idempotency cho `accept/reject/end`.
- Validate payload signaling.
- Mapping `call status -> system_call message` đúng nội dung và metadata.

### 8.2 Integration

- Gateway <-> chat-service RPC.
- Stream consumer publish/broadcast.
- Redis/Mongo consistency sau crash/retry.

### 8.3 E2E

- 1-1 audio call.
- 1-1 video call.
- Caller cancel trước khi callee accept.
- Callee reject.
- Timeout không trả lời.
- Mất mạng và reconnect trong grace window.
- Kiểm tra conversation list và message timeline luôn phản ánh trạng thái call mới nhất.

## 9) SLO/SLI gợi ý cho production

- Call setup success rate >= 99%
- P95 call setup latency <= 3s (signaling side)
- Unexpected drop rate <= 1%
- WS event delivery success >= 99.9%

## 10) Runbook vận hành

Khi sự cố:

1. Kiểm tra health `api-gateway`, `chat-service`, Redis, Mongo.
2. Kiểm tra stream lag `chat:events`.
3. Kiểm tra lỗi token media/SFU.
4. Kiểm tra TURN reachability.
5. Nếu lỗi diện rộng: disable feature flag call/video call, giữ chat hoạt động.

## 11) Checklist agent trước khi merge

- Có migration/schema/index đầy đủ.
- Có test unit + integration + e2e cho flow call cơ bản.
- Có metric/log/correlationId.
- Có docs API/WS contract.
- Có kế hoạch rollback đã thử trên staging.

---

## Appendix A - Quy ước coding cho agent

- Không xử lý media stream trong Nest service.
- Không bypass authz theo conversation membership.
- Không update state call theo kiểu blind write.
- Không phát event trước khi transaction/domain state commit thành công.

## Appendix B - Chiến lược rollout

1. Enable nội bộ (staff only).
2. Canary 5% user.
3. Theo dõi 24-48h.
4. Mở rộng 25% -> 50% -> 100%.
