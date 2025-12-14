import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { BaseInitService } from 'src/common/search/base-init.service';
import { GROUP_INDEX, GroupIndexMapping } from '../group/group.mapping';

@Injectable()
export class GroupInitService extends BaseInitService implements OnModuleInit {
  indexName = GROUP_INDEX;
  constructor(esClient: Client) {
    super(esClient);
  }

  onModuleInit() {
    this.ensureIndex(GroupIndexMapping);
  }
}
