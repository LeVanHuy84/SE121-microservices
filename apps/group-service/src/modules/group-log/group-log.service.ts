import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CursorPageResponse,
  GroupEventLog,
  GroupLogFilter,
  GroupLogResponseDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupLog } from 'src/entities/group-log.entity';
import { EntityManager, Repository } from 'typeorm';

@Injectable()
export class GroupLogService {
  constructor(
    @InjectRepository(GroupLog) private readonly logRepo: Repository<GroupLog>,
  ) {}

  async log(
    manager: EntityManager,
    data: {
      groupId: string;
      userId: string;
      eventType: GroupEventLog;
      content: string;
    },
  ) {
    const repo = manager.getRepository(GroupLog);
    const event = repo.create(data);
    await repo.save(event);
  }

  async getLogsByGroupId(
    groupId: string,
    filter: GroupLogFilter,
  ): Promise<CursorPageResponse<GroupLogResponseDTO>> {
    const { startTime, endTime, eventType, cursor, limit, sortBy, order } =
      filter;

    const query = this.logRepo
      .createQueryBuilder('log')
      .where('log.groupId = :groupId', { groupId });

    if (startTime) {
      query.andWhere('log.createdAt >= :startTime', { startTime });
    }

    if (endTime) {
      query.andWhere('log.createdAt <= :endTime', { endTime });
    }

    if (eventType) {
      query.andWhere('log.eventType = :eventType', { eventType });
    }

    if (cursor) {
      const allowed = ['id', 'createdAt'];
      const col = allowed.includes(sortBy) ? sortBy : 'id';
      const op = order && order.toUpperCase() === 'ASC' ? '>' : '<';
      query.andWhere(`log.${col} ${op} :cursor`, { cursor });
    }

    query.orderBy(`log.${sortBy}`, order).limit(limit + 1);

    const logs = await query.getMany();

    const hasNextPage = logs.length === limit;
    const nextCursor = hasNextPage ? logs[logs.length - 1][sortBy] : null;
    if (hasNextPage) {
      logs.pop();
    }

    return {
      data: plainToInstance(GroupLogResponseDTO, logs, {
        excludeExtraneousValues: true,
      }),
      nextCursor,
      hasNextPage,
    };
  }
}
