import { IndexerService } from 'src/modules/indexer/indexer.service';

export abstract class BaseIndexService {
  abstract indexName: string;

  constructor(protected readonly indexer: IndexerService) {}

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
