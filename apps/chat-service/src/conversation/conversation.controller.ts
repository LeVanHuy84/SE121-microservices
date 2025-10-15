import { Controller } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateConversationDTO, CursorPaginationDTO } from '@repo/dtos';

@Controller()
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @MessagePattern('getConversations')
  async getConversations(
    @Payload()
    data: {
      userId: string;
      query: CursorPaginationDTO;
    },
  ) {
    return this.conversationService.getConversations(data.userId, data.query);
  }

  @MessagePattern('createConversation')
  async createConversation(
    @Payload()
    data: {
      type: 'private' | 'group';
      participants: string[];
      groupName?: string;
    },
  ) {
    return this.conversationService.createConversation(
      data.type,
      data.participants,
      data.groupName,
    );
  }
}
