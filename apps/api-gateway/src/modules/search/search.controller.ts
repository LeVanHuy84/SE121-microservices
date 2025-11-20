import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SearchGroupDto, SearchPostDto } from '@repo/dtos';
import { lastValueFrom } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('search')
export class SearchController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.SEARCH_SERVICE)
    private searchClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private postClient: ClientProxy
  ) {}

  @Get()
  checkHealth() {
    return 'check';
  }

  @Get('posts')
  async searchPosts(
    @CurrentUserId() currentUserId: string,
    @Query() filter: SearchPostDto
  ) {
    const result = await lastValueFrom(
      this.searchClient.send('search_posts', filter)
    );
    const postIds = result.postIds;
    const posts = await lastValueFrom(
      this.postClient.send('get_posts_batch', {
        currentUserId,
        postIds,
      })
    );
    return {
      data: posts,
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  }

  @Get('groups')
  async searchGroups(@Query() filter: SearchGroupDto) {
    const result = await lastValueFrom(
      this.searchClient.send('search_groups', filter)
    );
    return result;
  }
}
