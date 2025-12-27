// src/notification/template.service.ts
import { Injectable } from '@nestjs/common';

type TemplatePayload = Record<string, any>;

type TemplateRenderer = (payload: TemplatePayload) => string;

@Injectable()
export class TemplateService {
  private templates: Record<string, TemplateRenderer> = {
    reaction: (payload) =>
      `${payload.actorName} đã thả cảm xúc cho bài đăng: ${payload.content || ''}...`, // chỗ này vì có thể là post/share
    comment: (payload) =>
      `${payload.actorName} đã bình luận tại bài đăng: ${payload.content || ''}...`,
    reply_comment: (payload) =>
      `${payload.actorName} đã phản hồi bình luận: ${payload.content || ''}...`,
    share: (payload) =>
      `${payload.actorName} đã chia sẻ bài đăng: ${payload.content || ''}`,
    follow: (payload) => `${payload.actorName} đã bắt đầu theo dõi bạn`,
    friendship_request: (payload) =>
      `${payload.actorName} đã gửi lời mời kết bạn tới bạn`,
    friendship_accept: (payload) =>
      `${payload.actorName} đã chấp nhận lời mời kết bạn của bạn`,

    group_noti: (payload) =>
      `Nhóm ${payload.groupName} có thông báo mới: ${payload.content || ''}`,
    // 👉 sau này thêm type mới chỉ cần thêm key ở đây
  };

  render(type: string, payload: TemplatePayload): string {
    const renderer = this.templates[type];
    if (renderer) {
      return renderer(payload);
    }
    // fallback nếu type không có template
    return payload?.text || JSON.stringify(payload);
  }
}
