import { Test, TestingModule } from '@nestjs/testing';
import { GroupConsumerService } from './group-consumer.service';
import { GroupIndexService } from '../../group/group-index.service';

describe('GroupConsumerService', () => {
  let service: GroupConsumerService;
  let groupIndexService: {
    indexDocument: jest.Mock;
    updatePartialDocument: jest.Mock;
    deleteDocument: jest.Mock;
  };

  beforeEach(async () => {
    groupIndexService = {
      indexDocument: jest.fn(),
      updatePartialDocument: jest.fn(),
      deleteDocument: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupConsumerService,
        {
          provide: GroupIndexService,
          useValue: groupIndexService,
        },
      ],
    }).compile();

    service = module.get<GroupConsumerService>(GroupConsumerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createGroupIndex', () => {
    it('should index group document', () => {
      const payload: any = {
        groupId: 'group-1',
        name: 'Tech Enthusiasts',
        description: 'Discuss tech and code',
        privacy: 'PUBLIC',
        avatarUrl: 'https://example.com/group.png',
        members: 42,
        createdAt: '2026-01-01T00:00:00Z',
      };

      service.createGroupIndex(payload);

      expect(groupIndexService.indexDocument).toHaveBeenCalledWith('group-1', {
        id: 'group-1',
        name: 'Tech Enthusiasts',
        description: 'Discuss tech and code',
        privacy: 'PUBLIC',
        avatarUrl: 'https://example.com/group.png',
        members: 42,
        createdAt: '2026-01-01T00:00:00Z',
      });
    });
  });

  describe('updateGroupIndex', () => {
    it('should update partial fields when provided', () => {
      const payload: any = {
        groupId: 'group-1',
        name: 'Updated Name',
        members: 50,
      };

      service.updateGroupIndex(payload);

      expect(groupIndexService.updatePartialDocument).toHaveBeenCalledWith(
        'group-1',
        {
          name: 'Updated Name',
          members: 50,
        },
      );
    });

    it('should not update document when no update fields are given', () => {
      const payload: any = {
        groupId: 'group-1',
      };

      service.updateGroupIndex(payload);

      expect(groupIndexService.updatePartialDocument).not.toHaveBeenCalled();
    });
  });

  describe('removeGroupIndex', () => {
    it('should delete group document by id', () => {
      service.removeGroupIndex({ groupId: 'group-1' } as any);

      expect(groupIndexService.deleteDocument).toHaveBeenCalledWith('group-1');
    });
  });
});
