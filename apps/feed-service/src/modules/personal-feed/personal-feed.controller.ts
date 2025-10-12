import { Controller } from '@nestjs/common';
import { PersonalFeedService } from './personal-feed.service';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { PaginationDTO } from '@repo/dtos';

@Controller('personal-feed')
export class PersonalFeedController {
  constructor(private readonly queryService: PersonalFeedService) {}

  @MessagePattern('get_my_feed')
  async getUserFeeds(
    @Payload() payload: { userId: string; query: PaginationDTO },
  ) {
    return await this.queryService.getUserFeed(payload.userId, payload.query);
  }

  @EventPattern('view_feed')
  async viewFeed(@Payload() feedItemIds: string[]) {
    await this.queryService.markFeedItemViewed(feedItemIds);
  }
}
