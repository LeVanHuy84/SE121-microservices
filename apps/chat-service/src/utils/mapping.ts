// src/common/mapping.ts
import { plainToInstance } from 'class-transformer';
import { MessageResponseDTO, ConversationResponseDTO } from '@repo/dtos';
import { Types } from 'mongoose';

// Helper: map message object (Document hoặc lean object) sang DTO
function toPlain(obj: any) {
  return typeof obj?.toObject === 'function' ? obj.toObject() : obj;
}

// Helper: map message object (Document hoặc lean object) sang DTO
function mapMessage(obj: any): MessageResponseDTO | undefined {
  if (!obj) return undefined;

  const base = toPlain(obj);

  // Lấy raw replyTo từ cả doc lẫn plain
  const rawReply = (obj as any).replyTo ?? base.replyTo;

  // Chỉ map replyTo nếu đã populate (là object, KHÔNG phải ObjectId)
  const hasPopulatedReply =
    rawReply &&
    typeof rawReply === 'object' &&
    !(rawReply instanceof Types.ObjectId);

  const replyTo = hasPopulatedReply ? mapMessage(rawReply) : undefined;
  const attachments = Array.isArray(base.attachments)
    ? base.attachments.map((a: any) => ({
        url: a.url,
        fileName: a.fileName,
        publicId: a.publicId,
        mimeType: a.mimeType,
        size: a.size,
        thumbnailUrl: a.thumbnailUrl,
      }))
    : [];

  return plainToInstance(
    MessageResponseDTO,
    {
      ...base,
      _id: base._id?.toString(),
      conversationId: base.conversationId?.toString(),
      replyTo,
      attachments,
    },
    { excludeExtraneousValues: true },
  );
}

export function populateAndMapMessage(
  msgDoc: any,
): MessageResponseDTO | undefined {
  // Nếu cần populate replyTo thì làm ở query trước khi gọi hàm này
  return mapMessage(msgDoc);
}

export function populateAndMapConversation(
  convDoc: any,
): ConversationResponseDTO {
  const base =
    typeof convDoc.toObject === 'function' ? convDoc.toObject() : convDoc;

  const groupAvatar = base.groupAvatar
    ? {
        url: String(base.groupAvatar.url),
        publicId: base.groupAvatar.publicId
          ? String(base.groupAvatar.publicId)
          : undefined,
      }
    : undefined;

  return plainToInstance(ConversationResponseDTO, {
    ...base,
    groupAvatar,
    _id: base._id?.toString(),
    participants: (base.participants || []).map((p: any) => String(p)),
    admins: (base.admins || []).map((a: any) => String(a)),
    lastSeenMessageId: base.lastSeenMessageId
      ? Object.fromEntries(
          // nếu dùng Map trong mongoose
          typeof base.lastSeenMessageId.entries === 'function'
            ? base.lastSeenMessageId.entries()
            : Object.entries(base.lastSeenMessageId),
        )
      : {},
    lastMessage: convDoc.lastMessage
      ? mapMessage(convDoc.lastMessage)
      : undefined,
    hideFor: (base.hiddenFor || []).map((h: any) => String(h)),
  });
}
