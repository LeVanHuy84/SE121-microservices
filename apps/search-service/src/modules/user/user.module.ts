import { Module } from '@nestjs/common';
import { IndexerModule } from '../indexer/indexer.module';
import { UserIndexService } from './user-index.service';
import { UserSearchService } from './user-search.service';

@Module({
  imports: [IndexerModule],
  providers: [UserIndexService, UserSearchService],
  exports: [UserSearchService, UserIndexService],
})
export class UserModule {}
