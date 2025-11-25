import { Client } from '@elastic/elasticsearch';
import { Inject } from '@nestjs/common';
import { CursorPageResponse } from '@repo/dtos';
import { ELASTIC_CLIENT } from 'src/elastic/elastic.module';

export abstract class BaseSearchService {
  abstract indexName: string;

  constructor(@Inject(ELASTIC_CLIENT) private readonly es: Client) {}

  /** Mặc định sort, service con override nếu muốn */
  defaultSort(): any[] {
    return [{ createdAt: 'desc' }, { id: 'asc' }];
  }

  /** Build search params + cursor */
  private buildParams(query: any, cursor?: string, size = 10, sort?: any[]) {
    const params: any = {
      index: this.indexName,
      size,
      query,
      sort: sort ?? this.defaultSort(),
    };

    if (cursor) {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
      params.search_after = decoded;
    }

    return params;
  }

  /** Execute search + handle cursor */
  private async execute(
    params: any,
    hitsMapper?: (hit: any, idx: number) => any,
  ): Promise<CursorPageResponse<any>> {
    const result = await this.es.search(params);
    const hits = result.hits?.hits ?? [];

    const nextCursor =
      hits.length === params.size && hits[hits.length - 1]?.sort
        ? Buffer.from(JSON.stringify(hits[hits.length - 1].sort)).toString(
            'base64',
          )
        : null;

    const data = hitsMapper ? hits.map(hitsMapper) : hits.map((h) => h._source);

    return { data, nextCursor, hasNextPage: hits.length === params.size };
  }

  /** Text search */
  textSearch(
    text: string,
    fields: string[],
    cursor?: string,
    size = 10,
    sort?: any[],
  ) {
    const params = this.buildParams(
      { multi_match: { query: text, fields } },
      cursor,
      size,
      sort,
    );
    return this.execute(params);
  }

  /** Bool search */
  boolSearch(boolQuery: any, cursor?: string, size = 10, sort?: any[]) {
    const params = this.buildParams({ bool: boolQuery }, cursor, size, sort);
    return this.execute(params);
  }

  /** Highlight search */
  highlightSearch(
    text: string,
    fields: string[],
    cursor?: string,
    size = 10,
    sort?: any[],
  ) {
    const params = this.buildParams(
      { multi_match: { query: text, fields } },
      cursor,
      size,
      sort,
    );
    params.highlight = fields.reduce((acc, f) => ({ ...acc, [f]: {} }), {});

    return this.execute(params, (h) => ({
      ...(h._source ?? {}),
      highlight: h.highlight,
    }));
  }
}
