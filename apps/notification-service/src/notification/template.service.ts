// src/notification/template.service.ts
import { Injectable } from '@nestjs/common';
import { share } from 'rxjs';

type TemplatePayload = Record<string, any>;

type TemplateRenderer = (payload: TemplatePayload) => string;

@Injectable()
export class TemplateService {
  private templates: Record<string, TemplateRenderer> = {
    reaction: (payload) =>
      `${payload.actorName} and others reacted to your content: ${payload.content || ''}`, // chỗ này vì có thể là post/share
    comment: (payload) =>
      `${payload.actorName} commented to your content: ${payload.content || ''}`,
    reply_comment: (payload) =>
      `${payload.actorName} replied to your comment: ${payload.commentText || ''}`,
    share: (payload) =>
      `${payload.actorName} shared your post: ${payload.content || ''}`,
    follow: (payload) => `${payload.actorName} started following you`,
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
