import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PersonalFeedQuery, TrendingQuery } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('feeds')
export class FeedController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.FEED_SERVICE)
    private client: ClientProxy
  ) {}

  @Get('trending')
  getTrendingFeed(@Query() query: TrendingQuery) {
    return this.client.send('get_trending', query);
  }

  @Get('my_feed')
  getMyFeed(
    @CurrentUserId() userId: string,
    @Query() query: PersonalFeedQuery
  ) {
    return this.client.send('get_my_feed', { userId, query });
  }

  @Post('views')
  viewFeed(@Body() feedItemIds: string[]) {
    this.client.emit('view_feed', feedItemIds);
  }
}
