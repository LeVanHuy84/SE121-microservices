import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateConversationDTO, SendMessageDTO } from '@repo/dtos';
import { RealtimeService } from './realtime.service';

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @MessagePattern('isParticipant')
  async isParticipant(
    @Payload() data: { conversationId: string; userId: string },
  ) {
    return this.realtimeService.isParticipant(data.conversationId, data.userId);
  }

}
