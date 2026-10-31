import { InjectRedis } from "@nestjs-modules/ioredis";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { GroupInfoDTO } from "@repo/dtos";
import Redis from "ioredis";
import { firstValueFrom } from "rxjs";
import { MICROSERVICES_CLIENT } from "src/constant";

@Injectable()
export class GroupClientService {
  private readonly logger = new Logger(GroupClientService.name);
  private readonly GROUP_CACHE_PREFIX = "group:info";
  private readonly TTL_SECONDS = 60 * 10; // 10 minutes cache TTL

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject(MICROSERVICES_CLIENT.USER_SOCIAL_SERVICE)
    private readonly userSocialClient: ClientProxy,
  ) {}

  async getGroupInfos(groupIds: string[]): Promise<Map<string, GroupInfoDTO>> {
    const result = new Map<string, GroupInfoDTO>();
    if (!groupIds?.length) return result;

    const uniqueIds = Array.from(new Set(groupIds.filter(Boolean)));
    if (!uniqueIds.length) return result;

    const uncachedIds: string[] = [];

    // 1️⃣ Check Redis cache in pipeline
    const pipeline = this.redis.pipeline();
    uniqueIds.forEach((id) =>
      pipeline.hgetall(`${this.GROUP_CACHE_PREFIX}:${id}`),
    );
    const cacheResults = await pipeline.exec();

    if (cacheResults) {
      cacheResults.forEach(([error, data], index) => {
        const id = uniqueIds[index];
        const hash = data as Record<string, string>;
        if (error || !hash || Object.keys(hash).length === 0) {
          uncachedIds.push(id);
        } else {
          result.set(id, {
            id,
            name: hash.name || "",
            avatarUrl: hash.avatarUrl || undefined,
          });
        }
      });
    } else {
      uncachedIds.push(...uniqueIds);
    }

    // 2️⃣ Fetch uncached IDs via RPC from user-social-service
    if (uncachedIds.length > 0) {
      try {
        const fetchedGroups: GroupInfoDTO[] = await firstValueFrom(
          this.userSocialClient.send<GroupInfoDTO[]>(
            "get_group_info_batch",
            uncachedIds,
          ),
        );

        if (Array.isArray(fetchedGroups) && fetchedGroups.length > 0) {
          const cachePipeline = this.redis.pipeline();
          for (const g of fetchedGroups) {
            result.set(g.id, g);
            const cacheKey = `${this.GROUP_CACHE_PREFIX}:${g.id}`;
            cachePipeline.hset(cacheKey, {
              id: g.id,
              name: g.name ?? "",
              avatarUrl: g.avatarUrl ?? "",
            });
            cachePipeline.expire(cacheKey, this.TTL_SECONDS);
          }
          await cachePipeline.exec();
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to fetch group info batch via RPC: ${err?.message}`,
        );
      }
    }

    return result;
  }
}
