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
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

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
  SendMessageDTO,
  SendCallSignalDTO,
  UpdateConversationDTO,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { lastValueFrom } from 'rxjs';

@Controller('chats')
export class ChatController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE)
    private readonly chatClient: ClientProxy
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
    return await lastValueFrom(
      this.chatClient.send<ConversationResponseDTO>('createConversation', {
        userId,
        dto,
      })
    );
  }

  @Put('conversations/:conversationId')
  updateConversation(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDTO
  ) {
    return this.chatClient.send('updateConversation', {
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
  acceptCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string
  ) {
    const dto: AcceptCallDTO = { callId };
    return this.chatClient.send('acceptCall', { userId, dto });
  }

  @Post('calls/:callId/reject')
  rejectCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string,
    @Body() body: Omit<RejectCallDTO, 'callId'>
  ) {
    const dto: RejectCallDTO = { callId, reason: body?.reason };
    return this.chatClient.send('rejectCall', { userId, dto });
  }

  @Post('calls/:callId/end')
  endCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string,
    @Body() body: Omit<EndCallDTO, 'callId'>
  ) {
    const dto: EndCallDTO = { callId, reason: body?.reason };
    return this.chatClient.send('endCall', { userId, dto });
  }

  @Post('calls/:callId/signal')
  sendCallSignal(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string,
    @Body() body: Omit<SendCallSignalDTO, 'callId'>
  ) {
    const dto: SendCallSignalDTO = { callId, ...body };
    return this.chatClient.send('sendCallSignal', { userId, dto });
  }

  @Post('calls/:callId/join')
  joinCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string
  ) {
    const dto: JoinCallDTO = { callId };
    return this.chatClient.send('joinCall', { userId, dto });
  }

  @Post('calls/:callId/leave')
  leaveCall(
    @CurrentUserId() userId: string,
    @Param('callId') callId: string
  ) {
    const dto: LeaveCallDTO = { callId };
    return this.chatClient.send('leaveCall', { userId, dto });
  }

  @Post('calls/:callId/kick')
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
}
