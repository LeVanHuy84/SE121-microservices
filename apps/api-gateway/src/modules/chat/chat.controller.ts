import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { Throttle } from '@nestjs/throttler';
import {
  AcceptCallDTO,
  CallSessionResponseDTO,
  ConversationResponseDTO,
  CreateCallDTO,
  CreateConversationDTO,
  CursorPaginationDTO,
  EndCallDTO,
  GetConversationsQueryDTO,
  JoinCallDTO,
  KickCallParticipantDTO,
  LeaveCallDTO,
  MessageResponseDTO,
  RejectCallDTO,
  SendCallSignalDTO,
  SendMessageDTO,
  StreamUserTokenResponseDTO,
  UpdateConversationDTO
} from '@repo/dtos';
import { lastValueFrom } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('chats')
export class ChatController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE)
    private readonly chatClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.SOCIAL_SERVICE)
    private readonly socialClient: ClientProxy
  ) {}

  @Get('conversations')
  getConversations(
    @CurrentUserId() userId: string,
    @Query() query: GetConversationsQueryDTO
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
    const targetIds = dto.participants || [];
    
    if (targetIds.length > 0) {
      const targets: any[] = await lastValueFrom(
        this.userClient.send('getUsersBatch', targetIds)
      );

      for (const targetId of targetIds) {
        if (targetId === userId) continue;
        const target = targets.find((t: any) => t.id === targetId);
        if (!target) continue;
        
        const messagePrivacy = target.privacySettings?.messagePrivacy || 'EVERYONE';
        if (messagePrivacy === 'FRIENDS') {
          const relation: any = await lastValueFrom(
            this.socialClient.send('get_relationship_status', { userId, targetId })
          );
          if (relation.status !== 'FRIEND') {
            throw new ForbiddenException(`Người dùng ${target.firstName} ${target.lastName} chỉ nhận tin nhắn từ bạn bè`);
          }
        }
      }
    }

    return await lastValueFrom(
      this.chatClient.send<ConversationResponseDTO>('createConversation', {
        userId,
        dto,
      })
    );
  }

  @Put('conversations/:conversationId')
  async updateConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDTO
  ) {
    const targetIds = dto.participantsToAdd || [];
    
    if (targetIds.length > 0) {
      const targets: any[] = await lastValueFrom(
        this.userClient.send('getUsersBatch', targetIds)
      );

      for (const targetId of targetIds) {
        if (targetId === userId) continue;
        const target = targets.find((t: any) => t.id === targetId);
        if (!target) continue;
        
        const messagePrivacy = target.privacySettings?.messagePrivacy || 'EVERYONE';
        if (messagePrivacy === 'FRIENDS') {
          const relation: any = await lastValueFrom(
            this.socialClient.send('get_relationship_status', { userId, targetId })
          );
          if (relation.status !== 'FRIEND') {
            throw new ForbiddenException(`Người dùng ${target.firstName} ${target.lastName} chỉ nhận tin nhắn từ bạn bè`);
          }
        }
      }
    }

    return await lastValueFrom(
      this.chatClient.send('updateConversation', {
        userId,
        conversationId,
        dto,
      })
    );
  }

  @Post('conversations/:conversationId/hide')
  async hideConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    return await lastValueFrom(
      this.chatClient.send('hideConversation', {
        userId,
        conversationId,
      })
    );
  }

  @Post('conversations/:conversationId/unhide')
  async unhideConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    return await lastValueFrom(
      this.chatClient.send('unhideConversation', {
        userId,
        conversationId,
      })
    );
  }

  @Post('conversations/:conversationId/leave')
  leaveConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    return this.chatClient.send('leaveConversation', {
      userId,
      conversationId,
    });
  }

  @Delete('conversations/:conversationId')
  deleteConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string
  ) {
    return this.chatClient.send('deleteConversation', {
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

  @Get('calls/:callId')
  getCallById(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string
  ) {
    return this.chatClient.send('getCallById', { userId, callId });
  }

  @Post('calls')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createCall(
    @CurrentUserId() userId: string,
    @Body() dto: CreateCallDTO
  ): Promise<CallSessionResponseDTO> {
    return await lastValueFrom(
      this.chatClient.send<CallSessionResponseDTO>('createCall', {
        userId,
        dto,
      })
    );
  }

  @Post('calls/:callId/accept')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  acceptCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string
  ) {
    const dto: AcceptCallDTO = { callId };
    return this.chatClient.send('acceptCall', { userId, dto });
  }

  @Post('calls/:callId/reject')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  rejectCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string,
    @Body() body: Omit<RejectCallDTO, 'callId'>
  ) {
    const dto: RejectCallDTO = { callId, reason: body?.reason };
    return this.chatClient.send('rejectCall', { userId, dto });
  }

  @Post('calls/:callId/end')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  endCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string,
    @Body() body: Omit<EndCallDTO, 'callId'>
  ) {
    const dto: EndCallDTO = { callId, reason: body?.reason };
    return this.chatClient.send('endCall', { userId, dto });
  }


  @Post('calls/:callId/join')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  joinCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string
  ) {
    const dto: JoinCallDTO = { callId };
    return this.chatClient.send('joinCall', { userId, dto });
  }

  @Post('calls/:callId/leave')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  leaveCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string
  ) {
    const dto: LeaveCallDTO = { callId };
    return this.chatClient.send('leaveCall', { userId, dto });
  }

  @Post('calls/:callId/kick')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  kickCallParticipant(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string,
    @Body() body: Omit<KickCallParticipantDTO, 'callId'>
  ) {
    const dto: KickCallParticipantDTO = {
      callId,
      targetUserId: body.targetUserId,
    };
    return this.chatClient.send('kickCallParticipant', { userId, dto });
  }

  @Post('calls/user-token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  issueUserMediaToken(@CurrentUserId() userId: string) {
    return this.chatClient.send<StreamUserTokenResponseDTO>(
      'issueUserMediaToken',
      { userId }
    );
  }
}
