import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import {
  ConversationResponseDTO,
  CreateConversationDTO,
  CursorPaginationDTO,
  MessageResponseDTO,
  SendMessageDTO,
  UpdateConversationDTO,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { ChatGateway } from './chat.gateway';
import { lastValueFrom } from 'rxjs';

@Controller('chats')
export class ChatController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE)
    private readonly chatClient: ClientProxy,

    private readonly chatWebsocket: ChatGateway
  ) {}

  @Get('conversations')
  getConversations(
    @CurrentUserId() userId: string,
    @Query() query: CursorPaginationDTO
  ) {
    return this.chatClient.send('getConversations', { userId, query });
  }

  @Get('conversations/:conversationId')
  getConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    return this.chatClient.send('getConversationById', {
      userId,
      conversationId,
    });
  }

  @Post('conversations')
  async createConversation(
    @CurrentUserId() userId: string,
    @Body() dto: CreateConversationDTO
  ): Promise<ConversationResponseDTO> {
    return await lastValueFrom(
      this.chatClient.send<ConversationResponseDTO>('createConversation', {
        userId,
        dto,
      })
    );
  }

  @Patch('conversations/:conversationId')
  updateConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDTO
  ) {
    return this.chatClient.emit('updateConversation', {
      userId,
      conversationId,
      dto,
    });
  }

  @Post('conversations/:conversationId/hide')
  async hideConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    await lastValueFrom(
      this.chatClient.send('hideConversation', {
        userId,
        conversationId,
      })
    );
    this.chatWebsocket.emitConversationHidden(conversationId, userId);
    return { success: true };
  }

  @Post('conversations/:conversationId/unhide')
  async unhideConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    await lastValueFrom(
      this.chatClient.send('unhideConversation', {
        userId,
        conversationId,
      })
    );
    this.chatWebsocket.emitConversationUnhidden(conversationId, userId);
    return { success: true };
  }

  @Post('conversations/:conversationId/leave')
  leaveConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    return this.chatClient.emit('leaveConversation', {
      userId,
      conversationId,
    });
  }

  @Delete('conversations/:conversationId')
  deleteConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    return this.chatClient.emit('deleteConversation', {
      userId,
      conversationId,
    });
  }

  @Post('conversations/:conversationId/read')
  markConversationAsRead(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: { lastMessageId?: string }
  ) {
    return this.chatClient.send('markConversationAsRead', {
      userId,
      conversationId,
      lastMessageId: body.lastMessageId,
    });
  }

  @Get('messages/:messageId')
  getMessageById(
    @Param('messageId') messageId: string,
    @CurrentUserId() userId: string
  ) {
    return this.chatClient.send('getMessageById', { userId, messageId });
  }

  @Get('conversations/:conversationId/messages')
  getMessages(
    @Param('conversationId') conversationId: string,
    @Query() query: CursorPaginationDTO,
    @CurrentUserId() userId: string
  ) {
    return this.chatClient.send('getMessages', {
      userId,
      conversationId,
      query,
    });
  }

  @Post('messages')
  sendMessage(@CurrentUserId() userId: string, @Body() dto: SendMessageDTO) {
    return this.chatClient.send<MessageResponseDTO>('sendMessage', {
      userId,
      dto,
    });
  }

  @Delete('messages/:messageId')
  deleteMessage(
    @CurrentUserId() userId: string,
    @Param('messageId') messageId: string
  ) {
    return this.chatClient.send('deleteMessage', { userId, messageId });
  }
}
