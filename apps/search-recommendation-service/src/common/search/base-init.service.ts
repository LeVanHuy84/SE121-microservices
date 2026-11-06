import { Client } from '@elastic/elasticsearch';
import { Inject, Logger } from '@nestjs/common';
import { ELASTIC_CLIENT } from 'src/elastic/elastic.module';

export abstract class BaseInitService {
  abstract indexName: string;
  protected readonly logger = new Logger(BaseInitService.name);

  constructor(@Inject(ELASTIC_CLIENT) private readonly es: Client) {}

  // Tạo index nếu chưa có
  async ensureIndex(mapping: any) {
    try {
      const exists = await this.es.indices.exists({ index: this.indexName });
      if (!exists) {
        await this.es.indices.create({
          index: this.indexName,
          body: mapping,
        });
        this.logger.log(`Created index "${this.indexName}"`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to ensure index "${this.indexName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
