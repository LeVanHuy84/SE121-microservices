import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  CallMediaTokenResponseDTO,
  CallSessionStatus,
  RequestCallMediaTokenDTO,
} from '@repo/dtos';
import { CallService } from './call.service';
import { StreamMediaProvider } from './media/stream-media.provider';
import { InjectModel } from '@nestjs/mongoose';
import { Conversation, ConversationDocument } from 'src/mongo/schema/conversation.schema';
import { Model } from 'mongoose';

@Injectable()
export class CallMediaService {
  private readonly logger = new Logger(CallMediaService.name);

  constructor(
    private readonly callService: CallService,
    private readonly streamProvider: StreamMediaProvider,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  async issueCallMediaToken(
    userId: string,
    dto: RequestCallMediaTokenDTO,
  ): Promise<CallMediaTokenResponseDTO> {
    const call = await this.callService.getAuthorizedCallForUser(dto.callId, userId);
    if (call.status !== CallSessionStatus.ACCEPTED) {
      throw new RpcException('Call is not active');
    }

    const conversation = await this.conversationModel
      .findById(call.conversationId)
      .lean()
      .exec();

    const moderatorUserIds = [
      call.initiatorId,
      ...(conversation?.admins || []),
    ].filter((id, index, self) => self.indexOf(id) === index);

    return this.streamProvider.issueParticipantToken({
      call,
      userId,
      preferAudioOnly: dto.preferAudioOnly,
      moderatorUserIds,
    });
  }
}
