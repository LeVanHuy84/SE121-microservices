import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CursorPaginationDTO } from '@repo/dtos';
import { ConversationService } from './conversation.service';

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

  @MessagePattern('getConversationById')
  async getConversationById(
    @Payload()
    data: {
      conversationId: string;
    },
  ) {
    return this.conversationService.getConversationById(data.conversationId);
  }

  @MessagePattern('getParticipantInConversation')
  async getParticipantInConversation(
    @Payload()
    data: {
      conversationId: string;
    },
  ) {
    return this.conversationService.getParticipantsInConversation(
      data.conversationId,
    );
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
