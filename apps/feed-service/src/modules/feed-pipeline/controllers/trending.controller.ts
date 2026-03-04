import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TrendingQuery } from '@repo/dtos';
import { TrendingService } from '../services/trending.service';

@Controller('trending')
export class TrendingController {
  constructor(private readonly trendingService: TrendingService) {}

  @MessagePattern('get_trending')
  async getTrending(
    @Payload() payload: { query: TrendingQuery; userId?: string },
  ) {
    return await this.trendingService.getTrendingPosts(
      payload.query,
      payload.userId,
    );
  }
}
