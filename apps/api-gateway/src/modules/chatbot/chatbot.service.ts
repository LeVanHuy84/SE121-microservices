import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssistantContextItemDto,
  AssistantMessageDto,
  AssistantRespondResponseDto,
  SortOrder,
} from '@repo/dtos';
import axios from 'axios';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';

type RetrievalTarget = 'post' | 'group' | 'user';

const POST_RETRIEVAL_KEYWORDS = [
  'post',
  'bai',
  'noi dung',
  'content',
  'caption',
];

const GROUP_RETRIEVAL_KEYWORDS = ['group', 'nhom', 'cong dong'];

const USER_RETRIEVAL_KEYWORDS = [
  'user',
  'nguoi',
  'ban be',
  'ket ban',
  'goi y',
  'friend',
  'recommend',
];

const DEFAULT_RETRIEVAL_TARGETS: RetrievalTarget[] = ['post', 'group'];

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(MICROSERVICES_CLIENTS.SEARCH_SERVICE)
    private readonly searchClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private readonly postClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private readonly groupClient: ClientProxy,
  ) {}

  async respond(userId: string, dto: AssistantMessageDto) {
    const baseUrl = this.configService.get<string>(
      'CHATBOT_SERVICE_URL',
      'http://localhost:4015',
    );
    const internalKey = this.configService.get<string>(
      'CHATBOT_INTERNAL_KEY',
      'chatbot-internal-key-123',
    );
    const timeoutMs = this.configService.get<number>(
      'CHATBOT_SERVICE_TIMEOUT_MS',
      30000,
    );

    try {
      const startedAt = Date.now();
      const contexts = await this.retrieveContexts(userId, dto.message);

      const res = await axios.post<AssistantRespondResponseDto>(
        `${baseUrl}/assistant/respond`,
        {
          userId,
          message: dto.message,
          contexts,
        },
        {
          headers: {
            'x-internal-key': internalKey,
          },
          timeout: timeoutMs,
        },
      );

      this.logger.debug(
        `CHATBOT_SERVICE responded: userId=${userId} provider=${res.data?.data?.provider} model=${res.data?.data?.model} durationMs=${Date.now() - startedAt}`,
      );
      return res.data;
    } catch (error) {
      const { status, body, reason } = this.describeFailure(error);
      this.logger.error(
        `CHATBOT_SERVICE failed: userId=${userId} reason=${reason}`,
      );
      throw new HttpException(body, status);
    }
  }

  private async retrieveContexts(
    userId: string,
    message: string,
  ): Promise<AssistantContextItemDto[]> {
    const query = message?.trim();
    if (!query) {
      return [];
    }

    const limit = this.configService.get<number>(
      'CHATBOT_RAG_CONTEXT_LIMIT',
      3,
    );
    const targets = this.resolveRetrievalTargets(query);
    const contexts: AssistantContextItemDto[] = [];

    const tasks: Array<Promise<AssistantContextItemDto[]>> = [];
    if (targets.has('post')) {
      tasks.push(this.retrievePostContexts(userId, query, limit));
    }
    if (targets.has('group')) {
      tasks.push(this.retrieveGroupContexts(query, limit));
    }
    if (targets.has('user')) {
      tasks.push(this.retrieveUserContexts(query, limit));
    }

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        contexts.push(...result.value);
      } else {
        this.logger.warn(
          `Assistant RAG context retrieval failed: ${result.reason}`,
        );
      }
    }

    return contexts.slice(0, limit * Math.max(1, targets.size));
  }

  private resolveRetrievalTargets(message: string) {
    const value = this.normalizeSearchText(message);
    const targets = new Set<RetrievalTarget>();

    if (this.hasAnyKeyword(value, POST_RETRIEVAL_KEYWORDS)) {
      targets.add('post');
    }

    if (this.hasAnyKeyword(value, GROUP_RETRIEVAL_KEYWORDS)) {
      targets.add('group');
    }

    if (this.hasAnyKeyword(value, USER_RETRIEVAL_KEYWORDS)) {
      targets.add('user');
    }

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
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
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

  private async retrievePostContexts(
    userId: string,
    query: string,
    limit: number,
  ): Promise<AssistantContextItemDto[]> {
    const searchResult = await lastValueFrom(
      this.searchClient.send('search_posts', {
        query,
        limit,
        sortBy: 'createdAt',
        order: SortOrder.DESC,
      }),
    );
    const postIds = Array.isArray(searchResult?.postIds)
      ? searchResult.postIds
      : [];
    if (!postIds.length) {
      return [];
    }

    const posts = await lastValueFrom(
      this.postClient.send('get_posts_batch', {
        currentUserId: userId,
        postIds,
      }),
    );

    return (Array.isArray(posts) ? posts : [])
      .filter((post) => post?.content)
      .map((post) => ({
        type: 'post',
        id: String(post.postId ?? post.id),
        title: post.group?.name ? `Post trong ${post.group.name}` : 'Post',
        content: String(post.content),
        source: 'search_posts',
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
    const searchResult = await lastValueFrom(
      this.searchClient.send('search_groups', {
        query,
        limit,
        sortBy: 'createdAt',
        order: SortOrder.DESC,
      }),
    );
    const groups = Array.isArray(searchResult?.data) ? searchResult.data : [];
    const groupIds = groups.map((group) => group.id).filter(Boolean);
    const hydratedGroups = groupIds.length
      ? await lastValueFrom(this.groupClient.send('get_group_info_batch', groupIds))
      : [];
    const hydratedById = new Map(
      (Array.isArray(hydratedGroups) ? hydratedGroups : []).map((group) => [
        group.id,
        group,
      ]),
    );

    return groups.map((group) => {
      const hydrated = hydratedById.get(group.id);
      const name = hydrated?.name ?? group.name ?? 'Group';
      return {
        type: 'group',
        id: String(group.id),
        title: name,
        content: [name, group.description]
          .filter(Boolean)
          .map(String)
          .join('\n'),
        source: 'search_groups',
        metadata: {
          privacy: group.privacy,
          members: group.members,
          createdAt: group.createdAt,
        },
      };
    });
  }

  private async retrieveUserContexts(
    query: string,
    limit: number,
  ): Promise<AssistantContextItemDto[]> {
    const searchResult = await lastValueFrom(
      this.searchClient.send('search_users', {
        query,
        limit,
      }),
    );
    const users = Array.isArray(searchResult?.data) ? searchResult.data : [];
    const userIds = users.map((user) => user.id).filter(Boolean);
    const hydratedUsers = userIds.length
      ? await lastValueFrom(this.userClient.send('getUsersBatch', userIds))
      : [];

    return (Array.isArray(hydratedUsers) ? hydratedUsers : users).map((user) => {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      const content = [
        fullName,
        user.bio,
        user.jobTitle,
        user.company,
        user.school,
        Array.isArray(user.interests) ? user.interests.join(', ') : undefined,
      ]
        .filter(Boolean)
        .map(String)
        .join('\n');

      return {
        type: 'user',
        id: String(user.id),
        title: fullName || 'User',
        content,
        source: 'search_users',
        metadata: {
          location: user.location,
        },
      };
    });
  }

  private describeFailure(error: unknown): {
    status: number;
    body: string | Record<string, unknown>;
    reason: string;
  } {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return {
          status: error.response.status,
          body: this.normalizeErrorBody(
            error.response.data,
            'Chatbot service error',
          ),
          reason: `http_${error.response.status}`,
        };
      }

      if (error.code === 'ECONNABORTED') {
        return {
          status: 504,
          body: 'Chatbot service timeout',
          reason: 'timeout',
        };
      }

      return {
        status: 502,
        body: 'Chatbot service unavailable',
        reason: error.code ?? error.message,
      };
    }

    return {
      status: 500,
      body: 'Chatbot gateway error',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  private normalizeErrorBody(
    value: unknown,
    fallback: string,
  ): string | Record<string, unknown> {
    if (typeof value === 'string') {
      return value;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return fallback;
  }
}
