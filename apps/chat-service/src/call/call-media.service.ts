import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  CallMediaTokenResponseDTO,
  CallSessionStatus,
  RequestCallMediaTokenDTO,
} from '@repo/dtos';
import { CallService } from './call.service';
import { StreamMediaProvider } from './media/stream-media.provider';

@Injectable()
export class CallMediaService {
  constructor(
    private readonly callService: CallService,
    private readonly streamProvider: StreamMediaProvider,
  ) {}

  async issueCallMediaToken(
    userId: string,
    dto: RequestCallMediaTokenDTO,
  ): Promise<CallMediaTokenResponseDTO> {
    const call = await this.callService.getAuthorizedCallForUser(dto.callId, userId);
    if (call.status !== CallSessionStatus.ACCEPTED) {
      throw new RpcException('Call is not active');
    }

    return this.streamProvider.issueParticipantToken({
      call,
      userId,
      preferAudioOnly: dto.preferAudioOnly,
    });
  }
}
