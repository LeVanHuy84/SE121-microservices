import { Injectable } from '@nestjs/common';
import { BaseIndexService } from 'src/common/search/base-index.service';
import { IndexerService } from '../indexer/indexer.service';
import { POST_INDEX } from './post.mapping';

@Injectable()
export class PostIndexService extends BaseIndexService {
  indexName = POST_INDEX;
  constructor(indexer: IndexerService) {
    super(indexer);
  }
}
