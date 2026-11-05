import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import {
  CreateConversationDTO,
  GetConversationsQueryDTO,
  UpdateConversationDTO,
} from '@repo/dtos';
import { ConversationService } from './conversation.service';

@Controller()
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @TcpMessagePattern('getConversations')
  async getConversations(
    @Payload()
    data: {
      userId: string;
      query: GetConversationsQueryDTO;
    },
  ) {
    return this.conversationService.getConversations(data.userId, data.query);
  }

  @TcpMessagePattern('getConversationById')
  async getConversationById(
    @Payload()
    data: {
      userId: string;
      conversationId: string;
    },
  ) {
    return this.conversationService.getConversationById(
      data.userId,
      data.conversationId,
    );
  }

  @TcpMessagePattern('createConversation')
  async createConversation(
    @Payload()
    data: {
      userId: string;
      dto: CreateConversationDTO;
    },
  ) {
    return this.conversationService.createConversation(data.userId, data.dto);
  }

  @TcpMessagePattern('updateConversation')
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

  @TcpMessagePattern('hideConversation')
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

  @TcpMessagePattern('unhideConversation')
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

  @TcpMessagePattern('leaveConversation')
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

  @TcpMessagePattern('deleteConversation')
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

  @TcpMessagePattern('markConversationAsRead')
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
