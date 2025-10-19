// src/notification/template.service.ts
import { Injectable } from '@nestjs/common';

type TemplatePayload = Record<string, any>;

type TemplateRenderer = (payload: TemplatePayload) => string;

@Injectable()
export class TemplateService {
  private templates: Record<string, TemplateRenderer> = {
    like: (payload) =>
      `${payload.actorName} liked your post: ${payload.postTitle || ''}`,
    comment: (payload) =>
      `${payload.actorName} commented: ${payload.commentText || ''}`,
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
