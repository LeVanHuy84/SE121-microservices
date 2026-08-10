import { Inject, Injectable } from '@nestjs/common';
import {
  CursorPageResponse,
  JoinRequestResponseDTO,
  JoinRequestFilter,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import { groupJoinRequests } from 'src/drizzle/schema/schema';

@Injectable()
export class GroupJoinRequestQueryService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async filterRequests(
    groupId: string,
    filter: JoinRequestFilter,
  ): Promise<CursorPageResponse<JoinRequestResponseDTO>> {
    const {
      sortBy = 'createdAt',
      order = 'DESC',
      cursor,
      limit = 20,
      status,
    } = filter;

    const conditions: any[] = [eq(groupJoinRequests.groupId, groupId)];

    if (status) {
      conditions.push(eq(groupJoinRequests.status, status as any));
    }

    if (cursor) {
      if (sortBy === 'createdAt') {
        conditions.push(
          order === 'DESC'
            ? lt(groupJoinRequests.createdAt, new Date(cursor))
            : gt(groupJoinRequests.createdAt, new Date(cursor)),
        );
      } else if (sortBy === 'id') {
        conditions.push(
          order === 'DESC'
            ? lt(groupJoinRequests.id, cursor)
            : gt(groupJoinRequests.id, cursor),
        );
      }
    }

    const orderExpr =
      order.toUpperCase() === 'DESC'
        ? desc(groupJoinRequests[sortBy])
        : asc(groupJoinRequests[sortBy]);

    const results = await this.db
      .select()
      .from(groupJoinRequests)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(limit + 1);

    const hasNextPage = results.length > limit;
    const data = results.slice(0, limit);

    const nextCursor = hasNextPage
      ? sortBy === 'createdAt'
        ? (data[data.length - 1].createdAt as Date).toISOString()
        : data[data.length - 1].id
      : null;

    return new CursorPageResponse<JoinRequestResponseDTO>(
      plainToInstance(JoinRequestResponseDTO, data),
      nextCursor,
      hasNextPage,
    );
  }
}
