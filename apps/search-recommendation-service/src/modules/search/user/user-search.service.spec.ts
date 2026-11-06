import { Test, TestingModule } from '@nestjs/testing';
import { UserSearchService } from './user-search.service';
import { ELASTIC_CLIENT } from '../../../elastic/elastic.module';
import { SearchUserDto } from '@repo/dtos';

describe('UserSearchService', () => {
  let service: UserSearchService;
  let mockEsClient: {
    search: jest.Mock;
  };

  beforeEach(async () => {
    mockEsClient = {
      search: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSearchService,
        {
          provide: ELASTIC_CLIENT,
          useValue: mockEsClient,
        },
      ],
    }).compile();

    service = module.get<UserSearchService>(UserSearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('users');
  });

  describe('TC-ES-07: searchUsers with best_fields and and operator', () => {
    it('should build query with fullName^3, bio, and filters', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _source: {
                id: 'u1',
                email: 'john@example.com',
                firstName: 'John',
                lastName: 'Doe',
                fullName: 'John Doe',
                avatarUrl: 'https://avatar.png',
                bio: 'Software engineer',
              },
              sort: [100, 'u1'],
            },
          ],
        },
      });

      const dto: SearchUserDto = {
        query: 'John engineer',
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
        limit: 10,
      };

      const result = await service.searchUsers(dto);

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'users',
          size: 10,
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: 'John engineer',
                    fields: ['fullName^3', 'bio'],
                    type: 'best_fields',
                    operator: 'and',
                  },
                },
              ],
              filter: [
                { term: { email: 'john@example.com' } },
                { term: { 'firstName.keyword': 'John' } },
                { term: { 'lastName.keyword': 'Doe' } },
              ],
            },
          },
        }),
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('u1');
      expect(result.data[0].email).toBe('john@example.com');
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });
});
