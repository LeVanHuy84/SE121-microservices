import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateConversationDTO, CursorPaginationDTO, UpdateConversationDTO } from '@repo/dtos';
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
      userId: string;
      conversationId: string;
    },
  ) {
    return this.conversationService.getConversationById(data.userId ,data.conversationId);
  }


  @MessagePattern('createConversation')
  async createConversation(
    @Payload()
    data: {
      userId: string;
      dto: CreateConversationDTO;
    },
  ) {
    return this.conversationService.createConversation(data.userId, data.dto);
  }

  @MessagePattern('updateConversation')
  async updateConversation(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
      dto: UpdateConversationDTO;
    },
  ) {
    return this.conversationService.updateConversation(
      data.userId,
      data.conversationId,
      data.dto,
    );
  }
  
  @MessagePattern('hideConversation')
  async hideConversation(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
    },
  ) {
    return this.conversationService.hideConversationForUser(
      data.userId,
      data.conversationId,
    );
  }

  @MessagePattern('unhideConversation')
  async unhideConversation(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
    },
  ) {
    return this.conversationService.unhideConversationForUser(
      data.userId,
      data.conversationId,
    );
  }

  @MessagePattern('leaveConversation')
  async leaveConversation(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
    },
  ) {
    return this.conversationService.leaveConversation(
      data.userId,
      data.conversationId,
    );
  }

  @MessagePattern('deleteConversation')
  async deleteConversation(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
    },
  ) {
    return this.conversationService.deleteConversation(
      data.userId,
      data.conversationId,
    );
  }


  @MessagePattern('markConversationAsRead')
  async markConversationAsRead(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
      lastMessageId?: string;
    },
  ) {
    return this.conversationService.markConversationAsRead(
      data.userId,
      data.conversationId,
      data.lastMessageId,
    );
  }
}
