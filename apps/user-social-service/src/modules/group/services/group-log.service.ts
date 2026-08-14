import { Inject, Injectable } from "@nestjs/common";
import {
  CursorPageResponse,
  GroupEventLog,
  GroupLogFilter,
  GroupLogResponseDTO,
} from "@repo/dtos";
import { plainToInstance } from "class-transformer";
import { and, asc, desc, eq, gte, gt, lt, lte } from "drizzle-orm";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import type { DrizzleDB } from "src/drizzle/types/drizzle.d";
import { groupLogs } from "src/drizzle/schema/schema";

@Injectable()
export class GroupLogService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async log(
    tx: any,
    data: {
      groupId: string;
      userId: string;
      eventType: GroupEventLog;
      content: string;
    },
  ) {
    await tx.insert(groupLogs).values(data);
  }

  async getLogsByGroupId(
    groupId: string,
    filter: GroupLogFilter,
  ): Promise<CursorPageResponse<GroupLogResponseDTO>> {
    const { startTime, endTime, eventType, cursor, limit, sortBy, order } =
      filter;

    const conditions: any[] = [eq(groupLogs.groupId, groupId)];

    if (startTime) {
      conditions.push(gte(groupLogs.createdAt, new Date(startTime)));
    }
    if (endTime) {
      conditions.push(lte(groupLogs.createdAt, new Date(endTime)));
    }
    if (eventType) {
      conditions.push(eq(groupLogs.eventType, eventType as any));
    }
    if (cursor) {
      const allowed = ["id", "createdAt"];
      const col = allowed.includes(sortBy) ? sortBy : "id";
      const isAsc = order && order.toUpperCase() === "ASC";
      if (col === "createdAt") {
        conditions.push(
          isAsc
            ? gt(groupLogs.createdAt, new Date(cursor))
            : lt(groupLogs.createdAt, new Date(cursor)),
        );
      } else {
        conditions.push(
          isAsc ? gt(groupLogs.id, cursor) : lt(groupLogs.id, cursor),
        );
      }
    }

    const orderExpr =
      order && order.toUpperCase() === "ASC"
        ? asc(groupLogs[sortBy] ?? groupLogs.createdAt)
        : desc(groupLogs[sortBy] ?? groupLogs.createdAt);

    const logs = await this.db
      .select()
      .from(groupLogs)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(limit + 1);

    const hasNextPage = logs.length === limit;
    const resultLogs = hasNextPage ? logs.slice(0, -1) : logs;
    const nextCursor = hasNextPage
      ? resultLogs[resultLogs.length - 1][sortBy]
      : null;

    return {
      data: plainToInstance(GroupLogResponseDTO, resultLogs, {
        excludeExtraneousValues: true,
      }),
      nextCursor,
      hasNextPage,
    };
  }
}
