import { Controller } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CursorPaginationDTO, SendMessageDTO } from '@repo/dtos';

@Controller()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @MessagePattern('sendMessage')
  async sendMessage(
    @Payload()
    data: {
      conversationId: string;
      senderId: string;
      dto: SendMessageDTO;
    },
  ) {
    return this.messageService.createMessage(
      data.conversationId,
      data.senderId,
      data.dto,
    );
  }

  @MessagePattern('getMessages')
  async getMessages(
    @Payload()
    data: {
      conversationId: string;
      query: CursorPaginationDTO;
    },
  ) {
    return this.messageService.getMessages(data.conversationId, data.query);
  }

  @MessagePattern('markMessageAsRead')
  async markMessageAsRead(
    @Payload()
    data: {
      conversationId: string;
      messageId: string;
      userId: string;
    },
  ) {
    return this.messageService.markSeen(data.messageId, data.userId);
  }

  @MessagePattern('reactMessage')
  async reactMessage(
    @Payload()
    data: {
      messageId: string;
      userId: string;
      emoji: string;
    },
  ) {
    return this.messageService.reactMessage(
      data.messageId,
      data.userId,
      data.emoji,
    );
  }

  @MessagePattern('deleteMessage')
  async deleteMessage(
    @Payload()
    data: {
      messageId: string;
    },
  ) {
    return this.messageService.deleteMessage(data.messageId);
  }
}
