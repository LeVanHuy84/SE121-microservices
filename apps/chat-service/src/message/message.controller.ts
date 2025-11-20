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
      conversationId: string;
      query: CursorPaginationDTO;
    },
  ) {
    return this.messageService.getMessages(data.conversationId, data.query);
  }


}
