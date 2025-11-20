import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { PostModule } from '../post/post.module';
import { GroupModule } from '../group/group.module';

@Module({
  imports: [PostModule, GroupModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
