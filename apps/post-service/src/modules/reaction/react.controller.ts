import { Controller } from '@nestjs/common';
import { ReactionService } from './react.service';
import { MessagePattern } from '@nestjs/microservices';
import { DisReactDto, GetReactionsDto, ReactDto } from '@repo/dtos';

@Controller('react')
export class ReactionController {
  constructor(private reactionService: ReactionService) {}

  @MessagePattern('react')
  react(data: { userId: string; dto: ReactDto }) {
    this.reactionService.react(data.userId, data.dto);
  }

  @MessagePattern('dis_react')
  disReact(data: { userId: string; dto: DisReactDto }) {
    this.reactionService.disReact(data.userId, data.dto);
  }

  @MessagePattern('get_reactions')
  getReactions(dto: GetReactionsDto) {
    return this.reactionService.getReactions(dto);
  }
}
