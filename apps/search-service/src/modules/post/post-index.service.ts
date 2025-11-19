import { Client } from '@elastic/elasticsearch';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { BaseIndexService } from 'src/common/search/base-index.service';
import { IndexerService } from '../indexer/indexer.service';
import { POST_INDEX, PostMapping } from './post.mapping';

@Injectable()
export class PostIndexService extends BaseIndexService implements OnModuleInit {
  indexName = POST_INDEX;
  constructor(esClient: Client, indexer: IndexerService) {
    super(esClient, indexer);
  }

  onModuleInit() {
    this.ensureIndex(PostMapping);
  }
}
