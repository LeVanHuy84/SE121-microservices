import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { BaseInitService } from 'src/common/search/base-init.service';
import { USER_INDEX, UserIndexMapping } from '../user/user.mapping';

@Injectable()
export class UserInitService extends BaseInitService implements OnModuleInit {
  indexName = USER_INDEX;
  constructor(esClient: Client) {
    super(esClient);
  }

  onModuleInit() {
    this.ensureIndex(UserIndexMapping);
  }
}
