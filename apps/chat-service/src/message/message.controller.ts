import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { MessageService } from './message.service';
import { Payload } from '@nestjs/microservices';
import { CursorPaginationDTO, SendMessageDTO } from '@repo/dtos';

@Controller()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @TcpMessagePattern('getMessages')
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

  @TcpMessagePattern('sendMessage')
  async sendMessage(
    @Payload()
    data: {
      userId: string;
      dto: SendMessageDTO;
    },
  ) {
    return this.messageService.sendMessage(data.userId, data.dto);
  }

  @TcpMessagePattern('deleteMessage')
  async deleteMessage(
    @Payload()
    data: {
      userId: string;
      messageId: string;
    },
  ) {
    return this.messageService.deleteMessage(data.userId, data.messageId);
  }

  @TcpMessagePattern('getMessageById')
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
