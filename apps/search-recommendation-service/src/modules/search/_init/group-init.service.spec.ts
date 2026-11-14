import { GroupInitService } from './group-init.service';

describe('GroupInitService', () => {
  let service: GroupInitService;
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
    service = new GroupInitService(mockEsClient as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('groups');
  });

  it('should call ensureIndex onModuleInit', async () => {
    const spy = jest.spyOn(service, 'ensureIndex').mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(spy).toHaveBeenCalled();
  });
});
