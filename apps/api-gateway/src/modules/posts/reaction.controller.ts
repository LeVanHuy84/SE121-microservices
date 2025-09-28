import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DisReactDTO, GetReactionsDTO, ReactDTO } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('reactions')
export class ReactionController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private client: ClientProxy
  ) {}

  @Post('react')
  react(@CurrentUserId() userId: string, @Body() dto: ReactDTO) {
    this.client.send('react', { userId, dto });
  }

  @Delete('dis-react')
  disReact(@CurrentUserId() userId: string, @Body() dto: DisReactDTO) {
    this.client.send('dis_react', { userId, dto });
  }

  @Get()
  getReactions(@Query() dto: GetReactionsDTO) {
    return this.client.send('get_reactions', dto);
  }
}
