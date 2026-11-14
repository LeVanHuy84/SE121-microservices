import { BaseInitService } from './base-init.service';

class TestInitService extends BaseInitService {
  indexName = 'test-init-index';
}

describe('BaseInitService', () => {
  let service: TestInitService;
  let mockEsClient: {
    indices: {
      exists: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    mockEsClient = {
      indices: {
        exists: jest.fn(),
        create: jest.fn(),
      },
    };

    service = new TestInitService(mockEsClient as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('test-init-index');
  });

  it('should create index if it does not exist', async () => {
    mockEsClient.indices.exists.mockResolvedValueOnce(false);
    mockEsClient.indices.create.mockResolvedValueOnce({ acknowledged: true });

    const mapping = { mappings: { properties: { id: { type: 'keyword' } } } };
    await service.ensureIndex(mapping);

    expect(mockEsClient.indices.exists).toHaveBeenCalledWith({
      index: 'test-init-index',
    });
    expect(mockEsClient.indices.create).toHaveBeenCalledWith({
      index: 'test-init-index',
      body: mapping,
    });
  });

  it('should not create index if it already exists', async () => {
    mockEsClient.indices.exists.mockResolvedValueOnce(true);

    await service.ensureIndex({});

    expect(mockEsClient.indices.exists).toHaveBeenCalledWith({
      index: 'test-init-index',
    });
    expect(mockEsClient.indices.create).not.toHaveBeenCalled();
  });

  it('should catch and log error without throwing unhandled rejection if ES fails', async () => {
    mockEsClient.indices.exists.mockRejectedValueOnce(
      new Error('ES Connection Refused'),
    );

    await expect(service.ensureIndex({})).resolves.not.toThrow();
  });
});
