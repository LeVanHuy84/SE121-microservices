import { Test, TestingModule } from '@nestjs/testing';
import { GroupSearchService } from './group-search.service';
import { ELASTIC_CLIENT } from '../../../elastic/elastic.module';
import {
  GroupPrivacy,
  SearchGroupDto,
  SearchGroupSortBy,
  SortOrder,
} from '@repo/dtos';

describe('GroupSearchService', () => {
  let service: GroupSearchService;
  let mockEsClient: {
    search: jest.Mock;
  };

  beforeEach(async () => {
    mockEsClient = {
      search: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupSearchService,
        {
          provide: ELASTIC_CLIENT,
          useValue: mockEsClient,
        },
      ],
    }).compile();

    service = module.get<GroupSearchService>(GroupSearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('groups');
  });

  describe('searchGroups', () => {
    it('should search groups with query, privacy, and sort by members DESC', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _source: {
                id: 'g1',
                name: 'NestJS Developers',
                description: 'Backend devs group',
                privacy: GroupPrivacy.PUBLIC,
                members: 150,
              },
              sort: [150, 'g1'],
            },
          ],
        },
      });

      const dto: SearchGroupDto = {
        query: 'NestJS',
        privacy: GroupPrivacy.PUBLIC,
        sortBy: SearchGroupSortBy.MEMBERS,
        order: SortOrder.DESC,
        limit: 5,
      };

      const result = await service.searchGroups(dto);

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'groups',
          size: 5,
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: 'NestJS',
                    fields: ['name^3', 'description'],
                  },
                },
              ],
              filter: [{ term: { privacy: GroupPrivacy.PUBLIC } }],
            },
          },
          sort: [{ members: 'desc' }, { id: 'asc' }],
        }),
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('g1');
      expect(result.data[0].name).toBe('NestJS Developers');
      expect(result.hasNextPage).toBe(false);
    });

    it('should filter by groupId and sort by createdAt ASC', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: { hits: [] },
      });

      const dto: SearchGroupDto = {
        query: '',
        groupId: 'g-exact',
        sortBy: SearchGroupSortBy.CREATED_AT,
        order: SortOrder.ASC,
        limit: 10,
      };

      const result = await service.searchGroups(dto);

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            bool: {
              must: [],
              filter: [{ term: { id: 'g-exact' } }],
            },
          },
          sort: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(result.data).toEqual([]);
    });
  });
});
