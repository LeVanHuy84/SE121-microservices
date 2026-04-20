import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom, of, timeout, catchError } from 'rxjs';

import { AssistantContextItemDto, SortOrder } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import {
  DEFAULT_RETRIEVAL_TARGETS,
  GROUP_RETRIEVAL_KEYWORDS,
  POST_RETRIEVAL_KEYWORDS,
  RetrievalTarget,
  USER_RETRIEVAL_KEYWORDS,
} from './chatbot-keywords';

@Injectable()
export class AssistantContextService {
  private readonly logger = new Logger(AssistantContextService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(MICROSERVICES_CLIENTS.SEARCH_SERVICE)
    private readonly searchClient: ClientProxy,
  ) {}

  async buildContexts(
    userId: string,
    message: string,
  ): Promise<AssistantContextItemDto[]> {
    const query = message?.trim();
    if (!query) return [];

    const perSourceLimit = this.configService.get<number>(
      'CHATBOT_RAG_PER_SOURCE_LIMIT',
      3,
    );
    const globalLimit = this.configService.get<number>(
      'CHATBOT_RAG_GLOBAL_LIMIT',
      5,
    );
    const retrievalTimeoutMs = this.configService.get<number>(
      'CHATBOT_RAG_RETRIEVAL_TIMEOUT_MS',
      1800,
    );
    const maxContentLength = this.configService.get<number>(
      'CHATBOT_RAG_MAX_CONTENT_LENGTH',
      600,
    );

    const targets = this.resolveRetrievalTargets(query);

    const tasks: Array<Promise<AssistantContextItemDto[]>> = [];

    if (targets.has('post')) {
      tasks.push(
        this.withTimeout(
          () => this.retrievePostContexts(query, perSourceLimit),
          retrievalTimeoutMs,
          'post',
        ),
      );
    }

    if (targets.has('group')) {
      tasks.push(
        this.withTimeout(
          () => this.retrieveGroupContexts(query, perSourceLimit),
          retrievalTimeoutMs,
          'group',
        ),
      );
    }

    if (targets.has('user')) {
      tasks.push(
        this.withTimeout(
          () => this.retrieveUserContexts(query, perSourceLimit),
          retrievalTimeoutMs,
          'user',
        ),
      );
    }

    const settled = await Promise.allSettled(tasks);

    let contexts: AssistantContextItemDto[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        contexts.push(...result.value);
      } else {
        this.logger.warn(
          `assistant.context build failed: ${String(result.reason)}`,
        );
      }
    }

    contexts = this.dedupeContexts(contexts);
    contexts = contexts.map((item) => this.trimContext(item, maxContentLength));
    contexts = this.applyLexicalFallbackScore(query, contexts);
    contexts = this.sortContexts(contexts);

    return contexts.slice(0, globalLimit);
  }

  private async withTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    source: string,
  ): Promise<T> {
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${source}_timeout`)), timeoutMs),
        ),
      ]);
    } catch (error) {
      this.logger.warn(
        `assistant.context source=${source} error=${String(error)}`,
      );
      return [] as T;
    }
  }

  private async retrievePostContexts(
    query: string,
    limit: number,
  ): Promise<AssistantContextItemDto[]> {
    const searchResult = await this.safeSend<any>(
      this.searchClient,
      'search_posts',
      {
        query,
        limit,
        order: SortOrder.DESC,
      },
      [],
    );

    const posts = Array.isArray(searchResult?.data) ? searchResult.data : [];
    return posts.map((post: any) => ({
      type: 'post',
      id: String(post.id),
      title: String(post.title ?? 'Post'),
      content: [post.title, post.content, post.caption]
        .filter(Boolean)
        .join('\n'),
      source: 'search_posts',
      score: this.toNumericScore(post.score),
      metadata: {
        userId: post.userId,
        groupId: post.groupId,
        createdAt: post.createdAt,
      },
    }));
  }

  private async retrieveGroupContexts(
    query: string,
    limit: number,
  ): Promise<AssistantContextItemDto[]> {
    const searchResult = await this.safeSend<any>(
      this.searchClient,
      'search_groups',
      {
        query,
        limit,
        order: SortOrder.DESC,
      },
      [],
    );

    const groups = Array.isArray(searchResult?.data) ? searchResult.data : [];
    return groups.map((group: any) => ({
      type: 'group',
      id: String(group.id),
      title: String(group.name ?? 'Group'),
      content: [group.name, group.description].filter(Boolean).join('\n'),
      source: 'search_groups',
      score: this.toNumericScore(group.score),
      metadata: {
        privacy: group.privacy,
        membersCount: group.membersCount,
        createdAt: group.createdAt,
      },
    }));
  }

  private async retrieveUserContexts(
    query: string,
    limit: number,
  ): Promise<AssistantContextItemDto[]> {
    const searchResult = await this.safeSend<any>(
      this.searchClient,
      'search_users',
      {
        query,
        limit,
        order: SortOrder.DESC,
      },
      [],
    );

    const users = Array.isArray(searchResult?.data) ? searchResult.data : [];
    return users.map((user: any) => {
      const fullName = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(' ');
      return {
        type: 'user',
        id: String(user.id),
        title: fullName || 'User',
        content: [
          fullName,
          user.bio,
          user.jobTitle,
          user.company,
          user.school,
          Array.isArray(user.interests) ? user.interests.join(', ') : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
        source: 'search_users',
        score: this.toNumericScore(user.score),
        metadata: {
          location: user.location,
        },
      };
    });
  }

  private async safeSend<T>(
    client: ClientProxy,
    pattern: string,
    payload: unknown,
    fallback: T,
  ): Promise<T> {
    try {
      return await lastValueFrom(
        client.send<T>(pattern, payload).pipe(
          timeout(
            this.configService.get<number>(
              'CHATBOT_RAG_RETRIEVAL_TIMEOUT_MS',
              1800,
            ),
          ),
          catchError((error) => {
            this.logger.warn(
              `assistant.context pattern=${pattern} failed: ${String(error)}`,
            );
            return of(fallback);
          }),
        ),
      );
    } catch {
      return fallback;
    }
  }

  private dedupeContexts(
    contexts: AssistantContextItemDto[],
  ): AssistantContextItemDto[] {
    const seen = new Set<string>();
    const result: AssistantContextItemDto[] = [];

    for (const item of contexts) {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }

    return result;
  }

  private trimContext(
    item: AssistantContextItemDto,
    maxContentLength: number,
  ): AssistantContextItemDto {
    const content = String(item.content ?? '');
    return {
      ...item,
      content:
        content.length > maxContentLength
          ? `${content.slice(0, maxContentLength)}...`
          : content,
    };
  }

  private sortContexts(
    contexts: AssistantContextItemDto[],
  ): AssistantContextItemDto[] {
    return [...contexts].sort((a, b) => {
      const sa = typeof a.score === 'number' ? a.score : 0;
      const sb = typeof b.score === 'number' ? b.score : 0;
      if (sa !== sb) return sb - sa;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  private toNumericScore(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private resolveRetrievalTargets(message: string) {
    const value = this.normalizeSearchText(message);
    const targets = new Set<RetrievalTarget>();

    if (this.hasAnyKeyword(value, POST_RETRIEVAL_KEYWORDS)) targets.add('post');
    if (this.hasAnyKeyword(value, GROUP_RETRIEVAL_KEYWORDS))
      targets.add('group');
    if (this.hasAnyKeyword(value, USER_RETRIEVAL_KEYWORDS)) targets.add('user');

    if (!targets.size) {
      for (const target of DEFAULT_RETRIEVAL_TARGETS) {
        targets.add(target);
      }
    }

    return targets;
  }

  private normalizeSearchText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0111/g, 'd')
      .replace(/\u0110/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private hasAnyKeyword(value: string, keywords: readonly string[]): boolean {
    return keywords.some((keyword) =>
      new RegExp(`(^|\\s)${this.escapeRegExp(keyword)}($|\\s)`).test(value),
    );
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private applyLexicalFallbackScore(
    query: string,
    contexts: AssistantContextItemDto[],
  ): AssistantContextItemDto[] {
    if (!contexts.length) return contexts;

    const weakResult = contexts.every(
      (item) => typeof item.score !== 'number' || Number(item.score) <= 0,
    );

    if (!weakResult) return contexts;

    return contexts.map((item) => {
      const lexical = this.computeLexicalScore(query, item);
      const base = typeof item.score === 'number' ? Number(item.score) : 0;
      return {
        ...item,
        score: Number((base + lexical).toFixed(6)),
      };
    });
  }

  private computeLexicalScore(
    query: string,
    item: AssistantContextItemDto,
  ): number {
    const normalizedQuery = this.normalizeSearchText(query);
    if (!normalizedQuery) return 0;

    const title = this.normalizeSearchText(String(item.title ?? ''));
    const content = this.normalizeSearchText(String(item.content ?? ''));
    const doc = `${title} ${content}`.trim();
    if (!doc) return 0;

    const tokens = Array.from(
      new Set(normalizedQuery.split(' ').filter((token) => token.length >= 2)),
    );

    if (!tokens.length) {
      return doc.includes(normalizedQuery) ? 1.2 : 0;
    }

    let tokenHits = 0;
    let score = 0;

    for (const token of tokens) {
      if (doc.includes(token)) {
        tokenHits += 1;
        score += title.includes(token) ? 0.55 : 0.35;
      }
    }

    if (doc.includes(normalizedQuery)) {
      score += 1.0;
    }

    score += (tokenHits / tokens.length) * 0.9;
    return Number(score.toFixed(6));
  }
}
