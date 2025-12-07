import { Controller } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CursorPaginationDTO, SendMessageDTO } from '@repo/dtos';
import { MessageStreamProducer } from './message-stream.producer';

@Controller()
export class MessageController {
  constructor(private readonly messageService: MessageService,
    private readonly messageStreamProducer: MessageStreamProducer
  ) {}

  @MessagePattern('getMessages')
  async getMessages(
    @Payload()
    data: {
      conversationId: string;
      query: CursorPaginationDTO;
    },
  ) {
    return this.messageService.getMessagesInConversation(
      data.conversationId,
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
    const msg = await this.messageService.sendMessage(data.userId, data.dto);
    await this.messageStreamProducer.publishMessageCreated(msg);
    return msg;

  }

  @MessagePattern('deleteMessage')
  async deleteMessage(
    @Payload()
    data: {
      userId: string;
      messageId: string;
    },
  ) {
    const msg = await this.messageService.deleteMessage(
      data.userId,
      data.messageId,
    );
    await this.messageStreamProducer.publishMessageDeleted(msg);
    return msg;
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
