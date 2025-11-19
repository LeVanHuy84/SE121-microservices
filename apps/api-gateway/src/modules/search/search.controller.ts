import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SearchPostDto } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';

@Controller('search')
export class SearchController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.SEARCH_SERVICE)
    private client: ClientProxy
  ) {}

  @Get()
  checkHealth() {
    return 'check';
  }

  @Get('posts')
  searchPosts(@Query() filter: SearchPostDto) {
    return this.client.send('search_posts', filter);
  }
}
