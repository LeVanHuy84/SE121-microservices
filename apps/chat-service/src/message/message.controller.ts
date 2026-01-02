import { Controller } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CursorPaginationDTO, SendMessageDTO } from '@repo/dtos';

@Controller()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @MessagePattern('getMessages')
  async getMessages(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
      query: CursorPaginationDTO;
    },
  ) {
    return this.messageService.getMessagesInConversation(
      data.userId,
      data.conversationId,
      data.query,
    );
  }

  @MessagePattern('sendMessage')
  async sendMessage(
    @Payload()
    data: {
      userId: string;
      dto: SendMessageDTO;
    },
  ) {
    return this.messageService.sendMessage(data.userId, data.dto);
  }

  @MessagePattern('deleteMessage')
  async deleteMessage(
    @Payload()
    data: {
      userId: string;
      messageId: string;
    },
  ) {
    return this.messageService.deleteMessage(data.userId, data.messageId);
  }

  @MessagePattern('getMessageById')
  async getMessageById(
    @Payload()
    data: {
      userId: string;
      messageId: string;
    },
  ) {
    return this.messageService.getMessageById(data.userId, data.messageId);
  }
}
