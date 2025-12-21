import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ContentEntryDTO,
  ContentEntryQuery,
  CursorPageResponse,
  PageResponse,
  ReportFilterDTO,
  ReportResponseDTO,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { TARGET_CONFIG } from 'src/constant';
import { Comment as CommentEntity } from 'src/entities/comment.entity';
import { Post } from 'src/entities/post.entity';
import { Report } from 'src/entities/report.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class ReadReportService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>
  ) {}

  async getReports(
    filter: ReportFilterDTO
  ): Promise<CursorPageResponse<ReportResponseDTO>> {
    const {
      groupId,
      reporterId,
      targetType,
      targetId,
      status,
      limit = 10,
      cursor,
      order = 'DESC',
      sortBy = 'createdAt',
    } = filter;

    const query = this.reportRepo.createQueryBuilder('report');

    if (groupId) query.andWhere('report.groupId = :groupId', { groupId });
    if (reporterId)
      query.andWhere('report.reporterId = :reporterId', { reporterId });
    if (targetType)
      query.andWhere('report.targetType = :targetType', { targetType });
    if (targetId) query.andWhere('report.targetId = :targetId', { targetId });
    if (status) query.andWhere('report.status = :status', { status });

    if (cursor) {
      const operator = order === 'ASC' ? '>' : '<';
      query.andWhere(`report.${sortBy} ${operator} :cursor`, { cursor });
    }

    query.orderBy(`report.${sortBy}`, order).take(limit + 1);

    const reports = await query.getMany();

    const hasNextPage = reports.length > limit;
    const data = hasNextPage ? reports.slice(0, limit) : reports;

    let nextCursor: string | null = null;
    if (hasNextPage) {
      const lastValue = data[data.length - 1][sortBy];
      nextCursor = lastValue
        ? lastValue instanceof Date
          ? lastValue.toISOString()
          : String(lastValue)
        : null;
    }

    return {
      data: plainToInstance(ReportResponseDTO, data),
      nextCursor,
      hasNextPage,
    };
  }

  async getContentEntry(
    filter: ContentEntryQuery
  ): Promise<PageResponse<ContentEntryDTO>> {
    const { targetType, createdAt, limit = 10, page = 1 } = filter;

    if (!targetType) {
      throw new RpcException('targetType is required');
    }

    const config = TARGET_CONFIG[targetType];
    if (!config) {
      throw new RpcException('Invalid targetType');
    }

    const offset = (page - 1) * limit;

    const selects = [
      `${config.alias}.id AS id`,
      `${config.alias}.content AS content`,
      `${config.alias}.created_at AS createdAt`,
      `COALESCE(${config.statsAlias}.reports, 0) AS reportCount`,
    ];

    if (targetType !== TargetType.SHARE) {
      selects.push(`${config.alias}.media AS media`);
    }

    const qb = this.dataSource
      .createQueryBuilder()
      .from(config.table, config.alias)
      .leftJoin(
        config.statsTable,
        config.statsAlias,
        `${config.statsAlias}.${config.statId} = ${config.alias}.id`
      )
      .select(selects)
      .addSelect(`'${targetType}'`, 'type');

    if (createdAt) {
      qb.andWhere(`${config.alias}.created_at >= :createdAt`, { createdAt });
    }

    const [rawData, total] = await Promise.all([
      qb
        .orderBy('reportCount', 'DESC')
        .offset(offset)
        .limit(limit)
        .getRawMany(),
      qb.getCount(),
    ]);

    const data: ContentEntryDTO[] = rawData.map((row) => ({
      id: row.id,
      type: targetType,
      content: row.content,
      medias: [...row.media],
      reportPendingCount: Number(row.reportCount),
      createdAt: row.createdAt,
    }));

    return new PageResponse(data, total, page, limit);
  }

  async getPostDashboard() {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // helper chuẩn hóa date
    const toKey = (d: any) => new Date(d).toISOString().slice(0, 10);

    const posts = await this.dataSource
      .getRepository(Post)
      .createQueryBuilder('p')
      .select(`DATE(p.created_at)`, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('p.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('p.is_deleted = false')
      .groupBy('DATE(p.created_at)')
      .getRawMany();

    const comments = await this.dataSource
      .getRepository(CommentEntity)
      .createQueryBuilder('c')
      .select(`DATE(c.created_at)`, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('c.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('c.is_deleted = false')
      .groupBy('DATE(c.created_at)')
      .getRawMany();

    const reports = await this.dataSource
      .getRepository(Report)
      .createQueryBuilder('r')
      .select(`DATE(r.created_at)`, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('r.created_at BETWEEN :start AND :end', { start, end })
      .groupBy('DATE(r.created_at)')
      .getRawMany();

    // init map 7 ngày
    const map = new Map<string, any>();

    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = toKey(d);

      map.set(key, {
        date: key,
        postCount: 0,
        commentCount: 0,
        reportCount: 0,
      });
    }

    posts.forEach((p) => {
      const key = toKey(p.date);
      if (map.has(key)) {
        map.get(key).postCount = Number(p.count);
      }
    });

    comments.forEach((c) => {
      const key = toKey(c.date);
      if (map.has(key)) {
        map.get(key).commentCount = Number(c.count);
      }
    });

    reports.forEach((r) => {
      const key = toKey(r.date);
      if (map.has(key)) {
        map.get(key).reportCount = Number(r.count);
      }
    });

    return Array.from(map.values());
  }
}
