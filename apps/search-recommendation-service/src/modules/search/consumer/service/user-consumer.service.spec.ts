import { Test, TestingModule } from '@nestjs/testing';
import { UserConsumerService } from './user-consumer.service';
import { UserIndexService } from '../../user/user-index.service';

describe('UserConsumerService', () => {
  let service: UserConsumerService;
  let userIndexService: {
    indexDocument: jest.Mock;
    updatePartialDocument: jest.Mock;
    deleteDocument: jest.Mock;
  };

  beforeEach(async () => {
    userIndexService = {
      indexDocument: jest.fn(),
      updatePartialDocument: jest.fn(),
      deleteDocument: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserConsumerService,
        {
          provide: UserIndexService,
          useValue: userIndexService,
        },
      ],
    }).compile();

    service = module.get<UserConsumerService>(UserConsumerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUserIndex', () => {
    it('should create document with concatenated fullName', () => {
      const payload: any = {
        userId: 'user-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
        avatarUrl: 'https://example.com/avatar.png',
        bio: 'Hello world',
        createdAt: '2026-01-01T00:00:00Z',
      };

      service.createUserIndex(payload);

      expect(userIndexService.indexDocument).toHaveBeenCalledWith('user-1', {
        id: 'user-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
        avatarUrl: 'https://example.com/avatar.png',
        bio: 'Hello world',
        createdAt: '2026-01-01T00:00:00Z',
        fullName: 'Alice Smith',
      });
    });
  });

  describe('updateUserIndex', () => {
    it('should update partial fields including recomputed fullName', () => {
      const payload: any = {
        userId: 'user-1',
        firstName: 'Alicia',
        bio: 'Updated bio',
      };

      service.updateUserIndex(payload);

      expect(userIndexService.updatePartialDocument).toHaveBeenCalledWith(
        'user-1',
        {
          firstName: 'Alicia',
          fullName: 'Alicia',
          bio: 'Updated bio',
        },
      );
    });

    it('should update email and avatarUrl', () => {
      const payload: any = {
        userId: 'user-1',
        email: 'newemail@example.com',
        avatarUrl: 'https://example.com/new.png',
      };

      service.updateUserIndex(payload);

      expect(userIndexService.updatePartialDocument).toHaveBeenCalledWith(
        'user-1',
        {
          email: 'newemail@example.com',
          avatarUrl: 'https://example.com/new.png',
        },
      );
    });

    it('should not call updatePartialDocument when no fields are provided', () => {
      const payload: any = {
        userId: 'user-1',
      };

      service.updateUserIndex(payload);

      expect(userIndexService.updatePartialDocument).not.toHaveBeenCalled();
    });
  });

  describe('removeUserIndex', () => {
    it('should call deleteDocument with userId', () => {
      service.removeUserIndex({ userId: 'user-1' } as any);

      expect(userIndexService.deleteDocument).toHaveBeenCalledWith('user-1');
    });
  });
});
