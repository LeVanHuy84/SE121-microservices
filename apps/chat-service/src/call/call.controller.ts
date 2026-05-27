import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AcceptCallDTO,
  CreateCallDTO,
  EndCallDTO,
  JoinCallDTO,
  KickCallParticipantDTO,
  LeaveCallDTO,
  RejectCallDTO,
  SendCallSignalDTO,
  StreamUserTokenResponseDTO,
} from '@repo/dtos';
import { CallService } from './call.service';
import { StreamMediaProvider } from './media/stream-media.provider';

@Controller()
export class CallController {
  constructor(
    private readonly callService: CallService,
    private readonly streamMediaProvider: StreamMediaProvider,
  ) {}

  @MessagePattern('getCallById')
  async getCallById(
    @Payload()
    data: {
      callId: string;
    },
  ) {
    return this.callService.getCallById(data.callId);
  }

  @MessagePattern('createCall')
  async createCall(
    @Payload()
    data: {
      userId: string;
      dto: CreateCallDTO;
    },
  ) {
    return this.callService.createCall(data.userId, data.dto);
  }

  @MessagePattern('acceptCall')
  async acceptCall(
    @Payload()
    data: {
      userId: string;
      dto: AcceptCallDTO;
    },
  ) {
    return this.callService.acceptCall(data.userId, data.dto);
  }

  @MessagePattern('rejectCall')
  async rejectCall(
    @Payload()
    data: {
      userId: string;
      dto: RejectCallDTO;
    },
  ) {
    return this.callService.rejectCall(data.userId, data.dto);
  }

  @MessagePattern('endCall')
  async endCall(
    @Payload()
    data: {
      userId: string;
      dto: EndCallDTO;
    },
  ) {
    return this.callService.endCall(data.userId, data.dto);
  }

  @MessagePattern('sendCallSignal')
  async sendCallSignal(
    @Payload()
    data: {
      userId: string;
      dto: SendCallSignalDTO;
    },
  ) {
    return this.callService.sendCallSignal(data.userId, data.dto);
  }

  @MessagePattern('joinCall')
  async joinCall(
    @Payload()
    data: {
      userId: string;
      dto: JoinCallDTO;
    },
  ) {
    return this.callService.joinCall(data.userId, data.dto);
  }

  @MessagePattern('leaveCall')
  async leaveCall(
    @Payload()
    data: {
      userId: string;
      dto: LeaveCallDTO;
    },
  ) {
    return this.callService.leaveCall(data.userId, data.dto);
  }

  @MessagePattern('kickCallParticipant')
  async kickCallParticipant(
    @Payload()
    data: {
      userId: string;
      dto: KickCallParticipantDTO;
    },
  ) {
    return this.callService.kickCallParticipant(data.userId, data.dto);
  }

  @MessagePattern('issueUserMediaToken')
  async issueUserMediaToken(
    @Payload()
    data: {
      userId: string;
    },
  ): Promise<StreamUserTokenResponseDTO> {
    const token = await this.streamMediaProvider.issueUserToken(data.userId);
    return { token };
  }
}
