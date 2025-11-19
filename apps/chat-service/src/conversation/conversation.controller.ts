import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateConversationDTO, CursorPaginationDTO } from '@repo/dtos';
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
    // return this.conversationService.getConversations(data.userId, data.query);
  }

  @MessagePattern('getConversationById')
  async getConversationById(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
    },
  ) {
    // return this.conversationService.getConversationById(data.userId ,data.conversationId);
  }

  @MessagePattern('getParticipantInConversation')
  async getParticipantInConversation(
    @Payload()
    data: {
      conversationId: string;
    },
  ) {
    // return this.conversationService.getParticipantsInConversation(
    //   data.conversationId,
    // );
  }

  @MessagePattern('createConversation')
  async createConversation(
    @Payload()
    data: {
      dto: CreateConversationDTO;
    },
  ) {
    // return this.conversationService.createConversation(data.dto);
  }

  @MessagePattern('deleteConversation')
  async deleteConversation(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
    },
  ) {
    // return this.conversationService.deleteConversation(data.conversationId);
  }
}
