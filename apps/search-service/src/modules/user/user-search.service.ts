import { Client } from '@elastic/elasticsearch';
import { Injectable } from '@nestjs/common';
import { BaseSearchService } from 'src/common/search/base-search.service';
import { USER_INDEX } from './user.mapping';
import { SearchUserDto, UserResponseDTO } from '@repo/dtos';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class UserSearchService extends BaseSearchService {
  indexName = USER_INDEX;
  constructor(esClient: Client) {
    super(esClient);
  }

  async searchUsers(dto: SearchUserDto) {
    const must: any[] = [];
    const filter: any[] = [];

    if (dto.query) {
      must.push({
        multi_match: {
          query: dto.query,
          fields: ['fullName^3', 'bio'],
          type: 'best_fields',
          operator: 'and',
        },
      });
    }

    if (dto.email) {
      filter.push({
        term: { email: dto.email },
      });
    }
    if (dto.firstName) {
      filter.push({
        term: { 'firstName.keyword': dto.firstName },
      });
    }

    if (dto.lastName) {
      filter.push({
        term: { 'lastName.keyword': dto.lastName },
      });
    }

    const result = await this.boolSearch(
      { must, filter },
      dto.cursor,
      dto.limit,
    );

    return {
      data: plainToInstance(UserResponseDTO, result.data, {
        excludeExtraneousValues: true,
      }),
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  }
}
