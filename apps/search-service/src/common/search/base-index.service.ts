import { Client } from '@elastic/elasticsearch';
import { Inject } from '@nestjs/common';
import { ELASTIC_CLIENT } from 'src/elastic/elastic.module';
import { IndexerService } from 'src/modules/indexer/indexer.service';

export abstract class BaseIndexService {
  abstract indexName: string;

  constructor(
    @Inject(ELASTIC_CLIENT) private readonly es: Client,
    protected readonly indexer: IndexerService,
  ) {}

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

  // Index hoặc update document
  indexDocument(id: string, doc: any) {
    this.indexer.addToBulk(
      this.indexName,
      {
        index: { _index: this.indexName, _id: id },
      },
      doc,
    );
  }

  // Update một phần document (partial)
  updatePartialDocument(id: string, partialDoc: any) {
    this.indexer.addToBulk(
      this.indexName,
      {
        update: { _index: this.indexName, _id: id },
      },
      { doc: partialDoc },
    );
  }

  // Xóa document
  deleteDocument(id: string) {
    this.indexer.addToBulk(this.indexName, {
      delete: { _index: this.indexName, _id: id },
    });
  }
}
