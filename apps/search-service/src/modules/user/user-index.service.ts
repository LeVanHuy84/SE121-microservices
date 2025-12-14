import { Injectable } from '@nestjs/common';
import { BaseIndexService } from 'src/common/search/base-index.service';
import { IndexerService } from '../indexer/indexer.service';
import { USER_INDEX } from './user.mapping';

@Injectable()
export class UserIndexService extends BaseIndexService {
  indexName = USER_INDEX;
  constructor(indexer: IndexerService) {
    super(indexer);
  }
}
