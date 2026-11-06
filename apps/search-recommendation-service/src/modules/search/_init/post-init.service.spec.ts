import { PostInitService } from './post-init.service';

describe('PostInitService', () => {
  let service: PostInitService;
  let mockEsClient: {
    indices: {
      exists: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    mockEsClient = {
      indices: {
        exists: jest.fn().mockResolvedValue(true),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    service = new PostInitService(mockEsClient as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('posts');
  });

  it('should call ensureIndex onModuleInit', async () => {
    const spy = jest.spyOn(service, 'ensureIndex').mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(spy).toHaveBeenCalled();
  });
});
