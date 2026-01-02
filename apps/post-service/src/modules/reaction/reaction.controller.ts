import { Controller } from '@nestjs/common';
import { ReactionService } from './reaction.service';
import { EventPattern, MessagePattern } from '@nestjs/microservices';
import { DisReactDTO, GetReactionsDTO, ReactDTO, TargetType } from '@repo/dtos';

@Controller('react')
export class ReactionController {
  constructor(private reactionService: ReactionService) {}

  @MessagePattern('react')
  react(data: { userId: string; dto: ReactDTO }) {
    return this.reactionService.react(data.userId, data.dto);
  }

  @MessagePattern('dis_react')
  disReact(data: { userId: string; dto: DisReactDTO }) {
    return this.reactionService.disReact(data.userId, data.dto);
  }

  @MessagePattern('get_reactions')
  getReactions(dto: GetReactionsDTO) {
    return this.reactionService.getReactions(dto);
  }

  @MessagePattern('get_reacted_types_batch')
  getReactedTypesBatch(data: {
    userId: string;
    targetType: TargetType;
    targetIds: string[];
  }) {
    return this.reactionService.getReactedTypesBatch(
      data.userId,
      data.targetType,
      data.targetIds
    );
  }
}
