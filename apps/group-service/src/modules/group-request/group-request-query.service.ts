import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CursorPageResponse,
  JoinRequestResponseDTO,
  JoinRequestFilter,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupJoinRequest } from 'src/entities/group-join-request.entity';
import { Repository } from 'typeorm';

@Injectable()
export class GroupJoinRequestQueryService {
  constructor(
    @InjectRepository(GroupJoinRequest)
    private readonly joinRequestRepo: Repository<GroupJoinRequest>,
  ) {}

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

    const query = this.joinRequestRepo
      .createQueryBuilder('request')
      .where('request.groupId = :groupId', { groupId });

    // Lọc theo trạng thái nếu có
    if (status) {
      query.andWhere('request.status = :status', { status });
    }

    // Phân trang dạng cursor-based
    if (cursor) {
      if (sortBy === 'createdAt') {
        query.andWhere(
          order === 'DESC'
            ? 'request.createdAt < :cursor'
            : 'request.createdAt > :cursor',
          { cursor },
        );
      } else if (sortBy === 'id') {
        query.andWhere(
          order === 'DESC' ? 'request.id < :cursor' : 'request.id > :cursor',
          { cursor },
        );
      }
    }

    // Sắp xếp và giới hạn
    query.orderBy(`request.${sortBy}`, order.toUpperCase() as 'ASC' | 'DESC');
    query.take(limit + 1); // lấy dư 1 bản ghi để kiểm tra hasNextPage

    const results = await query.getMany();

    // Kiểm tra còn trang tiếp theo không
    const hasNextPage = results.length > limit;
    const data = results.slice(0, limit);

    // Lấy nextCursor (từ bản ghi cuối cùng trong danh sách hợp lệ)
    const nextCursor = hasNextPage
      ? sortBy === 'createdAt'
        ? data[data.length - 1].createdAt.toISOString()
        : data[data.length - 1].id
      : null;

    return new CursorPageResponse<JoinRequestResponseDTO>(
      plainToInstance(JoinRequestResponseDTO, data),
      nextCursor,
      hasNextPage,
    );
  }
}
