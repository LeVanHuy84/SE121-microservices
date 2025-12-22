import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ContentEntryDTO,
  ContentEntryQuery,
  CursorPageResponse,
  DashboardQueryDTO,
  PageResponse,
  ReportFilterDTO,
  ReportResponseDTO,
  ReportStatus,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { TARGET_CONFIG } from 'src/constant';
import { Comment as CommentEntity } from 'src/entities/comment.entity';
import { Post } from 'src/entities/post.entity';
import { Report } from 'src/entities/report.entity';
import { Share } from 'src/entities/share.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class ReadReportService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>
  ) {}
  private readonly VN_OFFSET_HOURS = 7;

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
    const { query, targetType, createdAt, limit = 10, page = 1 } = filter;

    if (!targetType) {
      throw new RpcException('targetType is required');
    }

    const config = TARGET_CONFIG[targetType];
    if (!config) {
      throw new RpcException('Invalid targetType');
    }

    const offset = (page - 1) * limit;

    // ===== BASE QUERY =====
    const baseQb = this.dataSource
      .createQueryBuilder()
      .from(config.table, config.alias)
      .leftJoin(
        config.statsTable,
        config.statsAlias,
        `${config.statsAlias}.${config.statId} = ${config.alias}.id`
      );

    if (createdAt) {
      baseQb.andWhere(`${config.alias}.created_at >= :createdAt`, {
        createdAt,
      });
    }

    if (query?.trim()) {
      baseQb.andWhere(`${config.alias}.content ILIKE :keyword`, {
        keyword: `%${query.trim()}%`,
      });
    }

    // ===== SELECT =====
    const selects = [
      `${config.alias}.id AS id`,
      `${config.alias}.content AS content`,
      `${config.alias}.created_at AS "createdAt"`,
      `COALESCE(${config.statsAlias}.reports, 0) AS "reportCount"`,
    ];

    if (targetType !== TargetType.SHARE) {
      selects.push(`${config.alias}.media AS media`);
    }

    // ===== DATA QUERY =====
    const rawData = await baseQb
      .clone()
      .select(selects)
      .addSelect(`'${targetType}'`, 'type')
      .orderBy('"reportCount"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany();

    // ===== COUNT QUERY =====
    const total = await baseQb.clone().getCount();

    // ===== MAP =====
    const data: ContentEntryDTO[] = rawData.map((row) => ({
      id: row.id,
      type: targetType,
      content: row.content,
      medias: this.normalizeMedias(row.media, targetType),
      reportPendingCount: Number(row.reportCount),
      createdAt: row.createdAt,
    }));

    return new PageResponse(data, total, page, limit);
  }

  async getContentChart(filter: DashboardQueryDTO) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ===== NORMALIZE DATE (VN → UTC) =====
    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default = 7 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(today)!;
    }

    if (!fromDate) {
      today.setDate(today.getDate() - 6);
      fromDate = this.vnDateToUtcStart(today)!;
    }

    // ===== LIMIT RANGE =====
    const MAX_DAYS = 30;
    const diffDays =
      Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

    if (diffDays > MAX_DAYS) {
      const d = new Date(toDate);
      d.setDate(d.getDate() - (MAX_DAYS - 1));
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // helper key theo NGÀY VN
    const toKey = (d: Date) =>
      new Date(d.getTime() + this.VN_OFFSET_HOURS * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

    // ===== POSTS =====
    const posts = await this.dataSource
      .getRepository(Post)
      .createQueryBuilder('p')
      .select(`DATE(p.created_at)`, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('p.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .andWhere('p.is_deleted = false')
      .groupBy('date')
      .getRawMany();

    // ===== COMMENTS =====
    const comments = await this.dataSource
      .getRepository(CommentEntity)
      .createQueryBuilder('c')
      .select(`DATE(c.created_at)`, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('c.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .andWhere('c.is_deleted = false')
      .groupBy('date')
      .getRawMany();

    // ===== SHARES =====
    const shares = await this.dataSource
      .getRepository(Share)
      .createQueryBuilder('s')
      .select(`DATE(s.created_at)`, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('s.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .groupBy('date')
      .getRawMany();

    // ===== INIT MAP =====
    const map = new Map<
      string,
      {
        date: string;
        postCount: number;
        commentCount: number;
        shareCount: number;
      }
    >();

    const days =
      Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

    for (let i = 0; i < days; i++) {
      const d = new Date(fromDate);
      d.setDate(d.getDate() + i);

      const key = toKey(d);
      map.set(key, {
        date: key,
        postCount: 0,
        commentCount: 0,
        shareCount: 0,
      });
    }

    // ===== MERGE DATA =====
    posts.forEach((p) => {
      if (map.has(p.date)) map.get(p.date)!.postCount = Number(p.count);
    });

    comments.forEach((c) => {
      if (map.has(c.date)) map.get(c.date)!.commentCount = Number(c.count);
    });

    shares.forEach((s) => {
      if (map.has(s.date)) map.get(s.date)!.shareCount = Number(s.count);
    });

    return Array.from(map.values());
  }

  async getReportChart(filter: DashboardQueryDTO) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ===== NORMALIZE DATE (VN → UTC) =====
    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default = 7 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(today)!;
    }

    if (!fromDate) {
      today.setDate(today.getDate() - 6);
      fromDate = this.vnDateToUtcStart(today)!;
    }

    // ===== LIMIT RANGE =====
    const MAX_DAYS = 30;
    const diffDays =
      Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

    if (diffDays > MAX_DAYS) {
      const d = new Date(toDate);
      d.setDate(d.getDate() - (MAX_DAYS - 1));
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // helper key theo ngày VN
    const toKey = (d: Date) =>
      new Date(d.getTime() + this.VN_OFFSET_HOURS * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

    // ===== REPORTS =====
    const reports = await this.dataSource
      .getRepository(Report)
      .createQueryBuilder('r')
      .select(`DATE(r.created_at)`, 'date')
      .addSelect('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('r.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .groupBy('date')
      .addGroupBy('r.status')
      .getRawMany();

    // ===== INIT MAP =====
    const map = new Map<
      string,
      {
        date: string;
        pendingCount: number;
        resolvedCount: number;
        rejectedCount: number;
      }
    >();

    const days =
      Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

    for (let i = 0; i < days; i++) {
      const d = new Date(fromDate);
      d.setDate(d.getDate() + i);

      const key = toKey(d);
      map.set(key, {
        date: key,
        pendingCount: 0,
        resolvedCount: 0,
        rejectedCount: 0,
      });
    }

    // ===== MERGE DATA =====
    reports.forEach((r) => {
      const key = toKey(new Date(r.date));
      const item = map.get(key);
      if (!item) return;

      const count = Number(r.count);

      switch (r.status) {
        case ReportStatus.PENDING:
          item.pendingCount = count;
          break;
        case ReportStatus.RESOLVED:
          item.resolvedCount = count;
          break;
        case ReportStatus.REJECTED:
          item.rejectedCount = count;
          break;
      }
    });

    return Array.from(map.values());
  }

  private normalizeToVNDate(value: string | Date): {
    y: number;
    m: number;
    d: number;
  } {
    let vnDate: Date;

    if (value instanceof Date) {
      vnDate = new Date(value);
    } else if (value.includes('T')) {
      // ISO string → Date
      vnDate = new Date(value);
    } else {
      // YYYY-MM-DD → coi là VN
      const [y, m, d] = value.split('-').map(Number);
      return { y, m, d };
    }

    // Convert UTC → VN
    vnDate = new Date(vnDate.getTime() + this.VN_OFFSET_HOURS * 60 * 60 * 1000);

    return {
      y: vnDate.getFullYear(),
      m: vnDate.getMonth() + 1,
      d: vnDate.getDate(),
    };
  }

  private vnDateToUtcStart(value?: Date | string): Date | undefined {
    if (!value) return undefined;

    const { y, m, d } = this.normalizeToVNDate(value);

    return new Date(Date.UTC(y, m - 1, d, -this.VN_OFFSET_HOURS, 0, 0, 0));
  }

  private vnDateToUtcEnd(value?: Date | string): Date | undefined {
    if (!value) return undefined;

    const { y, m, d } = this.normalizeToVNDate(value);

    return new Date(
      Date.UTC(y, m - 1, d, 23 - this.VN_OFFSET_HOURS, 59, 59, 999)
    );
  }

  private normalizeMedias(media: any, type: TargetType) {
    if (!media) return [];

    if (type === TargetType.POST) return media;
    if (type === TargetType.COMMENT) return [media];
  }
}
