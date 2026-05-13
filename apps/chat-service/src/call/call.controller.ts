import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AcceptCallDTO,
  CallMediaTokenResponseDTO,
  CreateCallDTO,
  EndCallDTO,
  JoinCallDTO,
  KickCallParticipantDTO,
  LeaveCallDTO,
  RejectCallDTO,
  RequestCallMediaTokenDTO,
  SendCallSignalDTO,
} from '@repo/dtos';
import { CallService } from './call.service';
import { CallMediaService } from './call-media.service';

@Controller()
export class CallController {
  constructor(
    private readonly callService: CallService,
    private readonly callMediaService: CallMediaService,
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

  @MessagePattern('issueCallMediaToken')
  async issueCallMediaToken(
    @Payload()
    data: {
      userId: string;
      dto: RequestCallMediaTokenDTO;
    },
  ): Promise<CallMediaTokenResponseDTO> {
    return this.callMediaService.issueCallMediaToken(data.userId, data.dto);
  }
}
