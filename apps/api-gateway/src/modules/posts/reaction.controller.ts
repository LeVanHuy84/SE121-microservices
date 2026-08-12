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
import { firstValueFrom } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('reactions')
export class ReactionController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.CONTENT_FEED_SERVICE)
    private client: ClientProxy,
  ) {}

  @Post()
  react(@CurrentUserId() userId: string, @Body() dto: ReactDTO) {
    return this.client.send('react', { userId, dto });
  }

  @Delete()
  disReact(@CurrentUserId() userId: string, @Body() dto: DisReactDTO) {
    return this.client.send('dis_react', { userId, dto });
  }

  @Get()
  async getReactions(@Query() dto: GetReactionsDTO) {
    return await firstValueFrom(this.client.send('get_reactions', dto));
  }
}
