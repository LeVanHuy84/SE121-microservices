import { BaseIndexService } from './base-index.service';

class TestIndexService extends BaseIndexService {
  indexName = 'test-index';
}

describe('BaseIndexService', () => {
  let service: TestIndexService;
  let mockIndexer: {
    addToBulk: jest.Mock;
  };

  beforeEach(() => {
    mockIndexer = {
      addToBulk: jest.fn(),
    };
    service = new TestIndexService(mockIndexer as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('test-index');
  });

  it('should add index action to bulk buffer in indexDocument', () => {
    service.indexDocument('doc-1', { title: 'Test' });

    expect(mockIndexer.addToBulk).toHaveBeenCalledWith(
      'test-index',
      { index: { _index: 'test-index', _id: 'doc-1' } },
      { title: 'Test' },
    );
  });

  it('should add update action to bulk buffer in updatePartialDocument', () => {
    service.updatePartialDocument('doc-1', { title: 'Updated' });

    expect(mockIndexer.addToBulk).toHaveBeenCalledWith(
      'test-index',
      { update: { _index: 'test-index', _id: 'doc-1' } },
      { doc: { title: 'Updated' } },
    );
  });

  it('should add delete action to bulk buffer in deleteDocument', () => {
    service.deleteDocument('doc-1');

    expect(mockIndexer.addToBulk).toHaveBeenCalledWith('test-index', {
      delete: { _index: 'test-index', _id: 'doc-1' },
    });
  });
});
