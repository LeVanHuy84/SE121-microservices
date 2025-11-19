import { Client } from '@elastic/elasticsearch';
import { Inject } from '@nestjs/common';
import { CursorPageResponse } from '@repo/dtos';
import { ELASTIC_CLIENT } from 'src/elastic/elastic.module';

export abstract class BaseSearchService {
  abstract indexName: string;

  constructor(@Inject(ELASTIC_CLIENT) private readonly es: Client) {}

  // Text search with cursor (for infinite scroll)
  async textSearch(
    query: string,
    fields: string[],
    cursor?: string,
    size = 10,
  ): Promise<CursorPageResponse<any>> {
    const searchParams: any = {
      index: this.indexName,
      size,
      query: {
        multi_match: { query, fields },
      },
      sort: [
        { _score: 'desc' },
        { createdAt: 'desc' }, // hoặc timestamp field của bạn
        { id: 'asc' }, // tie-breaker
      ],
    };

    if (cursor) {
      const decodedCursor = JSON.parse(
        Buffer.from(cursor, 'base64').toString(),
      );
      searchParams.search_after = decodedCursor;
    }

    const result = await this.es.search(searchParams);
    const hits = result.hits.hits;

    let nextCursor: string | null = null;
    if (hits.length === size) {
      const lastHit = hits[hits.length - 1];
      nextCursor = Buffer.from(JSON.stringify(lastHit.sort)).toString('base64');
    }

    return {
      data: hits.map((h) => h._source),
      nextCursor,
      hasNextPage: hits.length === size,
    };
  }

  // Bool query with cursor
  async boolSearch(
    body: any,
    cursor?: string,
    size = 10,
    sortFields = [{ createdAt: 'desc' }, { id: 'asc' }],
  ): Promise<CursorPageResponse<any>> {
    const searchParams: any = {
      index: this.indexName,
      size,
      query: { bool: body },
      sort: sortFields,
    };

    if (cursor) {
      const decodedCursor = JSON.parse(
        Buffer.from(cursor, 'base64').toString(),
      );
      searchParams.search_after = decodedCursor;
    }

    const result = await this.es.search(searchParams);
    const hits = result.hits.hits;

    let nextCursor: string | null = null;
    if (hits.length === size) {
      const lastHit = hits[hits.length - 1];
      nextCursor = Buffer.from(JSON.stringify(lastHit.sort)).toString('base64');
    }

    return {
      data: hits.map((h) => h._source),
      nextCursor,
      hasNextPage: hits.length === size,
    };
  }

  // Search with highlight + cursor
  async highlightSearch(
    query: string,
    fields: string[],
    cursor?: string,
    size = 10,
  ): Promise<CursorPageResponse<any>> {
    const searchParams: any = {
      index: this.indexName,
      size,
      query: {
        multi_match: { query, fields },
      },
      highlight: {
        fields: fields.reduce((acc, f) => ({ ...acc, [f]: {} }), {}),
      },
      sort: [{ _score: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    };

    if (cursor) {
      const decodedCursor = JSON.parse(
        Buffer.from(cursor, 'base64').toString(),
      );
      searchParams.search_after = decodedCursor;
    }

    const result = await this.es.search(searchParams);
    const hits = result.hits.hits;

    let nextCursor: string | null = null;
    if (hits.length === size) {
      const lastHit = hits[hits.length - 1];
      nextCursor = Buffer.from(JSON.stringify(lastHit.sort)).toString('base64');
    }

    return {
      data: hits.map((h) => {
        const src = (h._source ?? {}) as Record<string, any>;
        return {
          ...src,
          highlight: h.highlight,
        };
      }),
      nextCursor,
      hasNextPage: hits.length === size,
    };
  }
}

// USAGE IN CONTROLLER/SERVICE:
/*
// First load
const result = await searchService.textSearch('keyword', ['title', 'content']);
// { data: [...], nextCursor: "eyJ...", hasMore: true }

// Load more (infinite scroll)
const nextResult = await searchService.textSearch(
  'keyword', 
  ['title', 'content'],
  result.nextCursor
);

// Frontend:
while (hasMore) {
  const { data, nextCursor, hasMore } = await loadMore(cursor);
  posts.push(...data);
  cursor = nextCursor;
}
*/
