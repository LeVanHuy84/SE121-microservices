import { Client } from '@elastic/elasticsearch';
import { Inject } from '@nestjs/common';
import { ELASTIC_CLIENT } from 'src/elastic/elastic.module';

export abstract class BaseInitService {
  abstract indexName: string;

  constructor(@Inject(ELASTIC_CLIENT) private readonly es: Client) {}

  // Tạo index nếu chưa có
  async ensureIndex(mapping: any) {
    const exists = await this.es.indices.exists({ index: this.indexName });
    if (!exists) {
      await this.es.indices.create({
        index: this.indexName,
        body: mapping,
      });
    }
  }
}
