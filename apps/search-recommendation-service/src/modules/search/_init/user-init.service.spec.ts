import { UserInitService } from './user-init.service';

describe('UserInitService', () => {
  let service: UserInitService;
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
    service = new UserInitService(mockEsClient as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('users');
  });

  it('should call ensureIndex onModuleInit', async () => {
    const spy = jest.spyOn(service, 'ensureIndex').mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(spy).toHaveBeenCalled();
  });
});
