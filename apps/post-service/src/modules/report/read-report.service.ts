import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ContentEntryDTO,
  ContentEntryQuery,
  ContentStatus,
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
import { Between, DataSource, Repository } from 'typeorm';

@Injectable()
export class ReadReportService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(Post) private readonly postRepo: Repository<Post>
  ) {}
  private readonly VN_OFFSET_HOURS = 7;

  // Dashboard
  async getDashboard(
    filter: DashboardQueryDTO
  ): Promise<{ totalPosts: number; pendingReports: number }> {
    // ===== TODAY (VN)
    const todayVN = new Date();
    todayVN.setHours(0, 0, 0, 0);

    // ===== NORMALIZE DATE (VN → UTC)
    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default = 7 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(todayVN)!;
    }

    if (!fromDate) {
      const d = new Date(todayVN);
      d.setDate(d.getDate() - 6);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // ===== TOTAL POSTS
    const totalPosts = await this.postRepo.count({
      where: {
        isDeleted: false,
        createdAt: Between(fromDate, toDate),
      },
    });

    // ===== PENDING REPORTS
    const pendingReports = await this.reportRepo.count({
      where: {
        status: ReportStatus.PENDING,
        createdAt: Between(fromDate, toDate),
      },
    });

    return {
      totalPosts,
      pendingReports,
    };
  }

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
    const {
      query,
      targetType,
      status,
      createdAt,
      limit = 10,
      page = 1,
    } = filter;

    if (!targetType) {
      throw new RpcException({
        statusCode: 400,
        message: 'targetType is required',
      });
    }

    const config = TARGET_CONFIG[targetType];
    if (!config) {
      throw new RpcException({
        statusCode: 400,
        message: 'Invalid targetType',
      });
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

    if (status !== undefined) {
      if (status === ContentStatus.ACTIVE) {
        baseQb.andWhere(`${config.alias}.is_deleted = false`);
      } else if (status === ContentStatus.VIOLATED) {
        baseQb.andWhere(`${config.alias}.is_deleted = true`);
      }
    }

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
      `${config.alias}.is_deleted AS "isDeleted"`,
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
      status: row.isDeleted ? ContentStatus.VIOLATED : ContentStatus.ACTIVE,
      createdAt: row.createdAt,
    }));

    return new PageResponse(data, total, page, limit);
  }

  async getContentChart(filter: DashboardQueryDTO) {
    // ===============================
    // 1. NORMALIZE FILTER (VN → UTC)
    // ===============================

    const todayVN = new Date();
    todayVN.setHours(0, 0, 0, 0);

    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default: 7 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(todayVN)!;
    }

    if (!fromDate) {
      const d = new Date(todayVN);
      d.setDate(d.getDate() - 6);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // ===============================
    // 2. LIMIT RANGE (MAX 30 DAYS)
    // ===============================

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

    // ===============================
    // 3. PREPARE DATE KEYS (VN)
    // ===============================

    const buildDateKeys = (from: Date, to: Date) => {
      const keys: string[] = [];
      const startVN = new Date(
        from.getTime() + this.VN_OFFSET_HOURS * 3600_000
      );
      const endVN = new Date(to.getTime() + this.VN_OFFSET_HOURS * 3600_000);

      const cursor = new Date(startVN);
      cursor.setHours(0, 0, 0, 0);

      while (cursor <= endVN) {
        keys.push(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }

      return keys;
    };

    const dateKeys = buildDateKeys(fromDate, toDate);

    // ===============================
    // 4. INIT MAP
    // ===============================

    const map = new Map<
      string,
      {
        date: string;
        postCount: number;
        commentCount: number;
        shareCount: number;
      }
    >();

    dateKeys.forEach((k) =>
      map.set(k, {
        date: k,
        postCount: 0,
        commentCount: 0,
        shareCount: 0,
      })
    );

    // ===============================
    // 5. QUERY HELPERS
    // ===============================

    const groupByVNDate = (alias: string, col = 'created_at') =>
      `to_char(timezone('Asia/Ho_Chi_Minh', ${alias}.${col}), 'YYYY-MM-DD')`;

    // ===============================
    // 6. POSTS
    // ===============================

    const posts = await this.dataSource
      .getRepository(Post)
      .createQueryBuilder('p')
      .select(groupByVNDate('p'), 'date')
      .addSelect('COUNT(*)', 'count')
      .where('p.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .andWhere('p.is_deleted = false')
      .groupBy('date')
      .getRawMany();

    // ===============================
    // 7. COMMENTS
    // ===============================

    const comments = await this.dataSource
      .getRepository(CommentEntity)
      .createQueryBuilder('c')
      .select(groupByVNDate('c'), 'date')
      .addSelect('COUNT(*)', 'count')
      .where('c.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .andWhere('c.is_deleted = false')
      .groupBy('date')
      .getRawMany();

    // ===============================
    // 8. SHARES
    // ===============================

    const shares = await this.dataSource
      .getRepository(Share)
      .createQueryBuilder('s')
      .select(groupByVNDate('s'), 'date')
      .addSelect('COUNT(*)', 'count')
      .where('s.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .groupBy('date')
      .getRawMany();

    // ===============================
    // 9. MERGE DATA
    // ===============================

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
    // ===============================
    // 1. NORMALIZE FILTER (VN → UTC)
    // ===============================

    const todayVN = new Date();
    todayVN.setHours(0, 0, 0, 0);

    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default: 7 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(todayVN)!;
    }

    if (!fromDate) {
      const d = new Date(todayVN);
      d.setDate(d.getDate() - 6);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // ===============================
    // 2. LIMIT RANGE (MAX 30 DAYS)
    // ===============================

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

    // ===============================
    // 3. BUILD DATE KEYS (VN)
    // ===============================

    const buildDateKeys = (from: Date, to: Date) => {
      const keys: string[] = [];

      const startVN = new Date(
        from.getTime() + this.VN_OFFSET_HOURS * 3600_000
      );
      const endVN = new Date(to.getTime() + this.VN_OFFSET_HOURS * 3600_000);

      const cursor = new Date(startVN);
      cursor.setHours(0, 0, 0, 0);

      while (cursor <= endVN) {
        keys.push(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }

      return keys;
    };

    const dateKeys = buildDateKeys(fromDate, toDate);

    // ===============================
    // 4. INIT MAP
    // ===============================

    const map = new Map<
      string,
      {
        date: string;
        pendingCount: number;
        resolvedCount: number;
        rejectedCount: number;
      }
    >();

    dateKeys.forEach((k) =>
      map.set(k, {
        date: k,
        pendingCount: 0,
        resolvedCount: 0,
        rejectedCount: 0,
      })
    );

    // ===============================
    // 5. QUERY REPORTS (GROUP BY NGÀY VN)
    // ===============================

    const reports = await this.dataSource
      .getRepository(Report)
      .createQueryBuilder('r')
      .select(
        `to_char(timezone('Asia/Ho_Chi_Minh', r.created_at), 'YYYY-MM-DD')`,
        'date'
      )
      .addSelect('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('r.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .groupBy('date')
      .addGroupBy('r.status')
      .getRawMany();

    // ===============================
    // 6. MERGE DATA
    // ===============================

    reports.forEach((r) => {
      const item = map.get(r.date);
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
