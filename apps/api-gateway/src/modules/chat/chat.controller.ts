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
  ) {
    const conv = await lastValueFrom(
      this.chatClient.send<ConversationResponseDTO>('createConversation', {
        userId,
        dto,
      })
    );
    this.chatWebsocket.emitConversationCreated(conv);
    return conv;
  }

  @Patch('conversations/:conversationId')
  async updateConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDTO
  ) {
    const conv = await lastValueFrom(
      this.chatClient.send<ConversationResponseDTO>('updateConversation', {
        userId,
        conversationId,
        dto,
      })
    );
    this.chatWebsocket.emitConversationUpdated(conv);

    if (dto.participantsToAdd?.length) {
      dto.participantsToAdd.forEach((joinedUserId) => {
        this.chatWebsocket.emitMemberJoined(
          conv._id,
          joinedUserId,
          conv.participants
        );
      });
    }

    // Nếu dto.removeParticipants có thì emit memberLeft
    if (dto.participantsToRemove?.length) {
      dto.participantsToRemove.forEach((leftUserId) => {
        this.chatWebsocket.emitMemberLeft(
          conv._id,
          leftUserId,
          conv.participants
        );
      });
    }
    return conv;
  }

  @Post('conversations/:conversationId/hide')
  hideConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {}

  @Post('conversations/:conversationId/unhide')
  unhideConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    return this.chatClient.send('unhideConversation', {
      userId,
      conversationId,
    });
  }

  @Post('conversations/:conversationId/leave')
  async leaveConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    const before = await lastValueFrom(
      this.chatClient.send<ConversationResponseDTO>('getConversationById', {
        userId,
        conversationId,
      })
    );
    await lastValueFrom(
      this.chatClient.send('leaveConversation', { userId, conversationId })
    );
    this.chatWebsocket.emitMemberLeft(
      conversationId,
      userId,
      before.participants
    );

    return { success: true };
  }

  @Delete('conversations/:conversationId')
  async deleteConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    let conv: ConversationResponseDTO | null = null;
    try {
      conv = await lastValueFrom(
        this.chatClient.send<ConversationResponseDTO>('getConversationById', {
          userId,
          conversationId,
        })
      );
    } catch {
      conv = null;
    }

    await lastValueFrom(
      this.chatClient.send('deleteConversation', { userId, conversationId })
    );

    if (conv) {
      // Nếu là group và admin xoá hẳn
      if (conv.isGroup) {
        this.chatWebsocket.emitConversationDeleted(
          conversationId,
          conv.participants
        );
      } else {
        // direct: đã chuyển thành hide cho riêng user, emit hidden
        this.chatWebsocket.emitConversationHidden(conversationId, userId);
      }
    }

    return { success: true };
  }

  @Post('conversations/:conversationId/read')
  async markConversationAsRead(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() body?: { lastMessageId?: string }
  ) {
    const lastSeenMessageId = await lastValueFrom(
      this.chatClient.send<string | null>('markConversationAsRead', {
        userId,
        conversationId,
        lastMessageId: body?.lastMessageId,
      })
    );
    this.chatWebsocket.broadcastConversationRead(
      conversationId,
      userId,
      lastSeenMessageId
    );
    return { success: true };
  }

  @Get('messages/:messageId')
  getMessageById(@Param('messageId') messageId: string) {
    return this.chatClient.send('getMessageById', { messageId });
  }

  @Get('conversations/:conversationId/messages')
  getMessages(
    @Param('conversationId') conversationId: string,
    @Query() query: CursorPaginationDTO
  ) {
    return this.chatClient.send('getMessages', { conversationId, query });
  }

  @Post('messages')
  async sendMessage(
    @CurrentUserId() userId: string,
    @Body() dto: SendMessageDTO
  ): Promise<MessageResponseDTO> {
    const msg = await lastValueFrom(
      this.chatClient.send<MessageResponseDTO>('sendMessage', { userId, dto })
    );

    return msg;
  }

  @Delete('messages/:messageId')
  async deleteMessage(
    @CurrentUserId() userId: string,
    @Param('messageId') messageId: string
  ): Promise<MessageResponseDTO> {
    const msg = await lastValueFrom(
      this.chatClient.send<MessageResponseDTO>('deleteMessage', {
        userId,
        messageId,
      })
    );
    this.chatWebsocket.broadcastMessageDeleted(msg);
    return msg;
  }
}
