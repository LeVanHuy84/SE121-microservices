import { Module } from '@nestjs/common';
import { PostIndexService } from './post-index.service';
import { PostSearchService } from './post-search.service';
import { IndexerModule } from '../indexer/indexer.module';

@Module({
  imports: [IndexerModule],
  providers: [PostIndexService, PostSearchService],
  exports: [PostSearchService, PostIndexService],
})
export class PostModule {}
