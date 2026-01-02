import { Injectable } from '@nestjs/common';
import { BaseIndexService } from 'src/common/search/base-index.service';
import { IndexerService } from '../indexer/indexer.service';
import { GROUP_INDEX } from './group.mapping';

@Injectable()
export class GroupIndexService extends BaseIndexService {
  indexName = GROUP_INDEX;
  constructor(indexer: IndexerService) {
    super(indexer);
  }
}
