import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { QueryService } from './services/query.service';
import { QueryCacheService } from './services/query-cache.service';

@Controller()
export class RecommendationController {
  private readonly logger = new Logger(RecommendationController.name);

  constructor(
    private readonly queryService: QueryService,
    private readonly cacheService: QueryCacheService,
  ) {}

  @MessagePattern('query_recommendation_candidates')
  async queryCandidates(@Payload() payload: any) {
    this.logger.log(
      `Received query candidates request: viewerId=${payload?.viewerId}`,
    );
    try {
      const result = await this.queryService.query(payload);
      return {
        success: true,
        data: result,
      };
    } catch (err) {
      this.logger.error(
        `Failed to query candidates: ${err.message}`,
        err.stack,
      );
      return {
        success: false,
        error: err.message,
      };
    }
  }

  @MessagePattern('get_recommendation_cache_stats')
  async getCacheStats() {
    return {
      success: true,
      data: {
        backend: 'redis',
        available: true,
      },
    };
  }
}
