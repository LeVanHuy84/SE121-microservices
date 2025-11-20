import { Controller, Logger } from '@nestjs/common';
import { PostSearchService } from '../post/post-search.service';
import { MessagePattern } from '@nestjs/microservices';
import { SearchGroupDto, SearchPostDto } from '@repo/dtos';
import { GroupSearchService } from '../group/group-search.service';

@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);
  constructor(
    private readonly postSearchService: PostSearchService,
    private readonly groupSearchService: GroupSearchService,
  ) {}

  @MessagePattern('search_posts')
  async searchPosts(filter: SearchPostDto) {
    const results = await this.postSearchService.searchPosts(filter);
    return results;
  }

  @MessagePattern('search_groups')
  async searchGroups(filter: SearchGroupDto) {
    const results = await this.groupSearchService.searchGroups(filter);
    return results;
  }
}
