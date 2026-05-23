import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  StreamUserTokenResponseDTO,
} from '@repo/dtos';
import { StreamMediaProvider } from './media/stream-media.provider';

@Injectable()
export class CallMediaService {
  private readonly logger = new Logger(CallMediaService.name);

  constructor(
    private readonly streamProvider: StreamMediaProvider,
  ) {}

  async issueUserMediaToken(
    userId: string,
  ): Promise<StreamUserTokenResponseDTO> {
    const token = await this.streamProvider.issueUserToken(userId);
    return { token };
  }
}
