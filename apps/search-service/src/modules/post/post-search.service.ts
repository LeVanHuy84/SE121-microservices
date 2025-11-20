import { Client } from '@elastic/elasticsearch';
import { Injectable } from '@nestjs/common';
import { BaseSearchService } from 'src/common/search/base-search.service';
import { POST_INDEX } from './post.mapping';
import { SearchPostDto, SortOrder } from '@repo/dtos';

@Injectable()
export class PostSearchService extends BaseSearchService {
  indexName = POST_INDEX;

  constructor(esClient: Client) {
    super(esClient);
  }

  async searchPosts(dto: SearchPostDto) {
    const must: any[] = [];
    const filter: any[] = [];
    const sortOrder = dto.order === SortOrder.ASC ? 'asc' : 'desc';
    const sortFields = [{ [dto.sortBy]: sortOrder }, { id: 'asc' }];

    if (dto.query) {
      must.push({
        multi_match: {
          query: dto.query,
          fields: ['content'],
        },
      });
    }

    if (dto.userId) filter.push({ term: { userId: dto.userId } });
    if (dto.groupId) filter.push({ term: { groupId: dto.groupId } });
    if (dto.emotion) filter.push({ term: { mainEmotion: dto.emotion } });

    const result = await this.boolSearch(
      { must, filter },
      dto.cursor,
      dto.limit,
      sortFields,
    );

    return {
      postIds: result.data.map((p) => p.id),
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
    };
  }
}
