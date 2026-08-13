import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { BaseInitService } from 'src/common/search/base-init.service';
import { POST_INDEX, PostMapping } from '../post/post.mapping';

@Injectable()
export class PostInitService extends BaseInitService implements OnModuleInit {
  indexName = POST_INDEX;
  constructor(esClient: Client) {
    super(esClient);
  }

  onModuleInit() {
    this.ensureIndex(PostMapping);
  }
}
