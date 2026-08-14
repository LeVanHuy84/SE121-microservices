import { Injectable } from "@nestjs/common";
import { NotificationPayload } from "@repo/dtos";

type TemplatePayload = NotificationPayload & Record<string, any>;

export type RenderedNotificationTemplate = {
  title: string;
  body: string;
  data: Record<string, string>;
  delivery: {
    androidChannelId: string;
  };
};

type TemplateRenderer = {
  title: (payload: TemplatePayload) => string;
  body: (payload: TemplatePayload) => string;
  data?: (payload: TemplatePayload) => Record<string, string>;
  delivery?: (
    payload: TemplatePayload,
  ) => RenderedNotificationTemplate["delivery"];
};

@Injectable()
export class TemplateService {
  private readonly templates: Record<string, TemplateRenderer> = {
    reaction: {
      title: () => "Tương tác mới",
      body: (payload) =>
        `${this.getActorName(payload)} đã thả cảm xúc cho bài đăng: ${this.getContentSnippet(payload)}`,
    },
    comment: {
      title: () => "Bình luận mới",
      body: (payload) =>
        `${this.getActorName(payload)} đã bình luận tại bài đăng: ${this.getContentSnippet(payload)}`,
    },
    reply_comment: {
      title: () => "Phản hồi mới",
      body: (payload) =>
        `${this.getActorName(payload)} đã phản hồi bình luận: ${this.getContentSnippet(payload)}`,
    },
    share: {
      title: () => "Lượt chia sẻ mới",
      body: (payload) =>
        `${this.getActorName(payload)} đã chia sẻ bài đăng: ${this.getContentSnippet(payload)}`,
    },
    follow: {
      title: () => "Người theo dõi mới",
      body: (payload) =>
        `${this.getActorName(payload)} đã bắt đầu theo dõi bạn`,
    },
    friendship_request: {
      title: () => "Lời mời kết bạn",
      body: (payload) =>
        `${this.getActorName(payload)} đã gửi lời mời kết bạn tới bạn`,
    },
    friendship_accept: {
      title: () => "Đã chấp nhận kết bạn",
      body: (payload) =>
        `${this.getActorName(payload)} đã chấp nhận lời mời kết bạn của bạn`,
    },
    group_noti: {
      title: () => "Thông báo nhóm",
      body: (payload) =>
        `Nhóm ${this.getActorName(payload)}: ${this.getContentSnippet(payload)}`,
    },
    group_invite: {
      title: () => "Lời mời vào nhóm",
      body: (payload) => this.getContentSnippet(payload),
    },
    base_noti: {
      title: () => "Thông báo",
      body: (payload) => this.getContentSnippet(payload),
    },
  };

  render(type: string, payload: TemplatePayload): string {
    return this.renderTemplate(type, payload).body;
  }

  renderTemplate(
    type: string,
    payload: TemplatePayload,
  ): RenderedNotificationTemplate {
    const template = this.templates[type];

    if (!template) {
      return this.buildDefaultTemplate(type, payload);
    }

    return {
      title: template.title(payload),
      body: template.body(payload),
      data: {
        targetId: payload.targetId ?? "",
        targetType: payload.targetType ?? "",
        actorName: payload.actorName ?? "",
        actorAvatar: payload.actorAvatar ?? "",
        ...this.stringifyRecord(template.data?.(payload) ?? {}),
      },
      delivery: {
        androidChannelId: "general",
        ...(template.delivery?.(payload) ?? {}),
      },
    };
  }

  private buildDefaultTemplate(
    type: string,
    payload: TemplatePayload,
  ): RenderedNotificationTemplate {
    return {
      title: this.humanizeType(type),
      body: this.getContentSnippet(payload),
      data: {
        targetId: payload.targetId ?? "",
        targetType: payload.targetType ?? "",
        actorName: payload.actorName ?? "",
        actorAvatar: payload.actorAvatar ?? "",
      },
      delivery: {
        androidChannelId: "general",
      },
    };
  }

  private getActorName(payload: TemplatePayload) {
    return payload.actorName?.trim() || "Ai đó";
  }

  private getContentSnippet(payload: TemplatePayload) {
    const rawValue =
      typeof payload.content === "string"
        ? payload.content
        : payload.text
          ? String(payload.text)
          : "";
    const normalized = rawValue.replace(/\s+/g, " ").trim();

    if (!normalized) {
      return "Bạn có thông báo mới";
    }

    return normalized.length > 120
      ? `${normalized.slice(0, 117).trim()}...`
      : normalized;
  }

  private humanizeType(type: string) {
    if (!type?.trim()) {
      return "Thông báo";
    }

    return type
      .split(/[_-]/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  private stringifyRecord(record: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        typeof value === "string"
          ? value
          : value === undefined || value === null
            ? ""
            : JSON.stringify(value),
      ]),
    );
  }
}
