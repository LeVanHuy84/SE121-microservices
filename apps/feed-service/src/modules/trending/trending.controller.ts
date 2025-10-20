import { Controller } from '@nestjs/common';
import { TrendingService } from './trending.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TrendingQuery } from '@repo/dtos';

@Controller('trending')
export class TrendingController {
  constructor(private readonly trendingService: TrendingService) {}

  @MessagePattern('get_trending')
  async getTrending(@Payload() query: TrendingQuery) {
    return await this.trendingService.getTrendingPosts(query);
  }
}
