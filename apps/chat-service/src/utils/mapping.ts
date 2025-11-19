// src/common/mapping.ts
import { plainToInstance } from 'class-transformer';
import { MessageResponseDTO, ConversationResponseDTO } from '@repo/dtos';

// Helper: map message object (Document hoặc lean object) sang DTO
function mapMessage(obj: any): MessageResponseDTO {
  if (!obj) return undefined as any;
  const base = typeof obj.toObject === 'function' ? obj.toObject() : obj;
  return plainToInstance(MessageResponseDTO, {
    ...base,
    id: base._id?.toString(),
    conversationId: base.conversationId?.toString(),
    replyTo: obj.replyTo ? mapMessage(obj.replyTo) : undefined,
  });
}

export async function populateAndMapMessage(msgDoc: any) : Promise<MessageResponseDTO> {
  // Nếu cần populate replyTo thì làm ở query trước khi gọi hàm này
  return mapMessage(msgDoc);
}

export async function populateAndMapConversation(convDoc: any) : Promise<ConversationResponseDTO> {
  // Nếu cần populate lastMessage và replyTo thì làm ở query trước khi gọi hàm này
  const base =
    typeof convDoc.toObject === 'function' ? convDoc.toObject() : convDoc;
  return plainToInstance(ConversationResponseDTO, {
    ...base,
    id: base._id?.toString(),
    participants: (base.participants || []).map((p: any) => String(p)),
    admins: (base.admins || []).map((a: any) => String(a)),
    lastMessage: convDoc.lastMessage
      ? mapMessage(convDoc.lastMessage)
      : undefined,
  });
}
