import { TcpMessagePattern, TcpEventPattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
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

  @TcpMessagePattern('getCallById')
  async getCallById(
    @Payload()
    data: {
      callId: string;
    },
  ) {
    return this.callService.getCallById(data.callId);
  }

  @TcpMessagePattern('createCall')
  async createCall(
    @Payload()
    data: {
      userId: string;
      dto: CreateCallDTO;
    },
  ) {
    return this.callService.createCall(data.userId, data.dto);
  }

  @TcpMessagePattern('acceptCall')
  async acceptCall(
    @Payload()
    data: {
      userId: string;
      dto: AcceptCallDTO;
    },
  ) {
    return this.callService.acceptCall(data.userId, data.dto);
  }

  @TcpMessagePattern('rejectCall')
  async rejectCall(
    @Payload()
    data: {
      userId: string;
      dto: RejectCallDTO;
    },
  ) {
    return this.callService.rejectCall(data.userId, data.dto);
  }

  @TcpMessagePattern('endCall')
  async endCall(
    @Payload()
    data: {
      userId: string;
      dto: EndCallDTO;
    },
  ) {
    return this.callService.endCall(data.userId, data.dto);
  }

  @TcpMessagePattern('joinCall')
  async joinCall(
    @Payload()
    data: {
      userId: string;
      dto: JoinCallDTO;
    },
  ) {
    return this.callService.joinCall(data.userId, data.dto);
  }

  @TcpMessagePattern('leaveCall')
  async leaveCall(
    @Payload()
    data: {
      userId: string;
      dto: LeaveCallDTO;
    },
  ) {
    return this.callService.leaveCall(data.userId, data.dto);
  }

  @TcpMessagePattern('kickCallParticipant')
  async kickCallParticipant(
    @Payload()
    data: {
      userId: string;
      dto: KickCallParticipantDTO;
    },
  ) {
    return this.callService.kickCallParticipant(data.userId, data.dto);
  }

  @TcpMessagePattern('issueUserMediaToken')
  async issueUserMediaToken(
    @Payload()
    data: {
      userId: string;
    },
  ): Promise<StreamUserTokenResponseDTO> {
    const token = await this.streamMediaProvider.issueUserToken(data.userId);
    return { token };
  }
  @TcpEventPattern('handleStreamCallEndedWebhook')
  async handleStreamCallEndedWebhook(
    @Payload()
    data: {
      callId: string;
    },
  ) {
    return this.callService.handleStreamCallEndedWebhook(data.callId);
  }
}
