# SPEC-ai-assistant-privacy-gate: User Privacy Policy Gate for AI Assistant

> **Version**: 1.0.0  
> **Status**: Backlog / Future Phase  
> **Date**: 2026-11-07  
> **Dependencies**: `SPEC-assistant-action-contract.md`, `SPEC-context-guidance.md`

---

## 1. Mục tiêu (Objective)

Cung cấp cơ chế phân quyền và kiểm soát quyền riêng tư chủ động (Privacy-by-Design Consent Gate) cho người dùng đối với Trợ lý AI (Sentimeta AI Assistant). Người dùng có quyền quyết định mức độ can thiệp của AI vào dữ liệu cá nhân và các thao tác tài khoản thông qua **1 trường chính sách duy nhất (`aiPolicy`)**.

---

## 2. Thiết kế miền dữ liệu (Domain Model)

### 2.1 Định nghĩa Enum `AiAssistantPolicy`

Được khai báo trong `@repo/dtos` và ánh xạ qua Pydantic / TypeScript:

```ts
export enum AiAssistantPolicy {
  /**
   * 🔒 STRICT (Riêng tư tối đa):
   * - AI không được phép truy cập bất kỳ dữ liệu cá nhân nào (vô hiệu hóa toàn bộ read-only tools cá nhân).
   * - AI không được đề xuất hoặc thực thi bất kỳ thao tác tài khoản nào.
   * - Hoạt động như cẩm nang FAQ / tra cứu hướng dẫn sử dụng công khai.
   */
  STRICT = 'STRICT',

  /**
   * 📖 READ_ONLY (Tiêu chuẩn):
   * - Cho phép AI đọc dữ liệu cá nhân theo ngữ cảnh (bạn bè, thông báo, cảm xúc, bài viết cá nhân).
   * - TUYỆT ĐỐI CẤM mọi hành động ghi (không sinh action proposal, từ chối lệnh execute).
   */
  READ_ONLY = 'READ_ONLY',

  /**
   * ⚡ FULL (Trợ lý toàn diện - Mặc định):
   * - Cho phép đọc dữ liệu cá nhân theo ngữ cảnh.
   * - Cho phép đề xuất các thao tác tài khoản nhanh (cần người dùng bấm xác nhận trên giao diện).
   */
  FULL = 'FULL',
}
```

### 2.2 Lưu trữ trong `user-social-service`

Tích hợp vào cột `privacy_settings` kiểu `jsonb` của bảng `profiles`:

```ts
// apps/user-social-service/src/drizzle/schema/profiles.schema.ts
export interface UserPrivacySettings {
  profileVisibility: PrivacyLevel;
  friendListVisibility: PrivacyLevel;
  messagePrivacy: MessagePrivacy;
  allowProactiveIntervention?: boolean;
  
  // 🛡️ Trường Policy duy nhất cho AI:
  aiPolicy?: AiAssistantPolicy; // Default: AiAssistantPolicy.FULL
}
```

---

## 3. Kiến trúc cổng chặn đa tầng (Multi-layered Enforcement)

### Tầng 1: Backend Guard (`ai-chatbot-service`)
1. **Tool Router Gate**:
   - Khi `aiPolicy === STRICT`: `tool_router.route()` lập tức trả về `[]` (bỏ qua mọi tool cá nhân).
2. **Action Proposal Gate**:
   - Khi `aiPolicy === STRICT` hoặc `aiPolicy === READ_ONLY`:
     - Bỏ qua hàm `_detect_action_proposals` và `_extract_proposals_from_llm_reply` $\rightarrow$ `proposals: []`.
3. **Execution Gate (`ActionExecutorService`)**:
   - Trước khi thực thi bất kỳ mutation nào, kiểm tra `aiPolicy` từ token/profile:
     - Nếu không phải `FULL`, từ chối ngay với mã lỗi: `AI_POLICY_RESTRICTED`.

### Tầng 2: Frontend Client Guard (`packages/shared`, `web`, `native`)
1. **Surface Blocker**:
   - Khi `aiPolicy === STRICT`: không đính kèm `surfaceContext` vào request gửi lên server.
2. **Action Card Blocker**:
   - Trong `ActionConfirmationCard`: nếu policy không cho phép ghi, hiển thị nhãn vô hiệu hóa và giải thích lý do bảo mật.
3. **Quick Switch trên Chat Header**:
   - Icon Khiên 🛡️ trên thanh tiêu đề của `AssistantSheet` (Web) và `AssistantChatModal` (Native) cho phép xem và đổi nhanh policy.

---

## 4. Kế hoạch triển khai khi bắt đầu làm (Roadmap)

1. **Sprint 1 (Contracts & Storage)**:
   - Thêm `AiAssistantPolicy` vào `@repo/dtos`.
   - Cập nhật DTO `UserPrivacySettingsDTO` và `profiles.schema.ts`.
2. **Sprint 2 (BE Enforcement)**:
   - Tích hợp middleware kiểm tra policy trong `ai-chatbot-service`.
   - Viết unit tests kiểm chứng 3 chế độ (`STRICT`, `READ_ONLY`, `FULL`).
3. **Sprint 3 (FE Settings & Chatbot Header UI)**:
   - Bổ sung tùy chọn trong `/settings/privacy`.
   - Thêm nút Shield Toggle trên giao diện Chatbot Web & Mobile.
