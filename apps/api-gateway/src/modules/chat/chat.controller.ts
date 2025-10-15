import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { CreateConversationDTO, CursorPaginationDTO, SendMessageDTO } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('chats')
export class ChatController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE) private readonly chatClient: ClientProxy
  ) {}

  @Get('conversations')
  getConversations(
    @CurrentUserId() userId: string,
    @Query() query: CursorPaginationDTO
  ){
    return this.chatClient.send('getConversations', { userId, query });
  }

  @Post('conversations')
  createConversation(
    @Body() data: CreateConversationDTO
  ){
    return this.chatClient.send('createConversation', { type: data.type, participants: data.participants, groupName: data.groupName });
  }

  @Get('conversations/:conversationId/messages')
  getMessages(
    @Param('conversationId') conversationId: string,
    @Query() query: CursorPaginationDTO
  ){
    return this.chatClient.send('getMessages', { conversationId, query });
  }

  @Post('conversations/:conversationId/messages')
  sendMessage(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
  ){
    return this.chatClient.send('sendMessage', { conversationId, senderId: userId, dto: SendMessageDTO });
  }

  
}
