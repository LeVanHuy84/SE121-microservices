import { Controller, Logger } from '@nestjs/common';
import { PostSearchService } from '../post/post-search.service';
import { MessagePattern } from '@nestjs/microservices';
import { SearchPostDto } from '@repo/dtos';

@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);
  constructor(private readonly postSearchService: PostSearchService) {}

  @MessagePattern('search_posts')
  async searchPosts(filter: SearchPostDto) {
    const results = await this.postSearchService.searchPosts(filter);
    this.logger.log(`Search results: ${JSON.stringify(results)}`);
    return results;
  }
}
