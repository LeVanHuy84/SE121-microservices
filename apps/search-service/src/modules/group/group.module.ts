import { Module } from '@nestjs/common';
import { IndexerModule } from '../indexer/indexer.module';
import { GroupIndexService } from './group-index.service';
import { GroupSearchService } from './group-search.service';

@Module({
  imports: [IndexerModule],
  providers: [GroupIndexService, GroupSearchService],
  exports: [GroupSearchService, GroupIndexService],
})
export class GroupModule {}
