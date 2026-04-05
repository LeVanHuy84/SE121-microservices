import { Controller } from '@nestjs/common';
import { PersonalFeedService } from '../services/personal-feed.service';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { PersonalFeedQuery } from '@repo/dtos';

@Controller('personal-feed')
export class PersonalFeedController {
  constructor(private readonly queryService: PersonalFeedService) {}

  @MessagePattern('get_my_feed')
  async getUserFeeds(
    @Payload() payload: { userId: string; query: PersonalFeedQuery },
  ) {
    return await this.queryService.getUserFeed(payload.userId, payload.query);
  }

  // @EventPattern('view_feed')
  // async viewFeed(
  //   @Payload() payload: { userId: string; feedItemIds: string[] },
  // ) {
  //   await this.queryService.markFeedItemViewed(
  //     payload.userId,
  //     payload.feedItemIds,
  //   );
  // }
}
