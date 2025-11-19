import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { PostModule } from '../post/post.module';

@Module({
  imports: [PostModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
