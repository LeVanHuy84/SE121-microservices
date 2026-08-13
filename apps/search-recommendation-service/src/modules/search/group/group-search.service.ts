import { Client } from '@elastic/elasticsearch';
import { Injectable } from '@nestjs/common';
import { BaseSearchService } from 'src/common/search/base-search.service';
import {
  CursorPageResponse,
  GroupSummaryResponse,
  SearchGroupDto,
  SearchGroupSortBy,
  SortOrder,
} from '@repo/dtos';
import { GROUP_INDEX } from './group.mapping';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class GroupSearchService extends BaseSearchService {
  indexName = GROUP_INDEX;

  constructor(esClient: Client) {
    super(esClient);
  }

  async searchGroups(
    dto: SearchGroupDto,
  ): Promise<CursorPageResponse<GroupSummaryResponse>> {
    const must: any[] = [];
    const filter: any[] = [];
    const sortOrder = dto.order === SortOrder.ASC ? 'asc' : 'desc';
    const sortBy =
      dto.sortBy === SearchGroupSortBy.MEMBERS ? 'members' : 'createdAt';
    const sortFields = [{ [sortBy]: sortOrder }, { id: 'asc' }];

    if (dto.query) {
      must.push({
        multi_match: {
          query: dto.query,
          fields: ['name^3', 'description'],
        },
      });
    }

    if (dto.groupId) filter.push({ term: { id: dto.groupId } });
    if (dto.privacy) filter.push({ term: { privacy: dto.privacy } });

    const result = await this.boolSearch(
      { must, filter },
      dto.cursor,
      dto.limit,
      sortFields,
    );

    return {
      data: plainToInstance(GroupSummaryResponse, result.data, {
        excludeExtraneousValues: true,
      }),
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  }
}
