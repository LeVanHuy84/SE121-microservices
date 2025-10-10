import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { PageResponse, PaginationDTO, ShareResponseDTO } from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { Share } from 'src/entities/share.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ShareQueryService {
  constructor(
    @InjectRepository(Share) private readonly shareRepo: Repository<Share>
  ) {}

  async findById(shareId: string): Promise<ShareResponseDTO> {
    const share = await this.shareRepo.findOne({
      where: { id: shareId },
      relations: ['post', 'shareStat'],
    });

    if (!share) {
      throw new RpcException(`Share not found`);
    }

    return plainToInstance(ShareResponseDTO, share, {
      excludeExtraneousValues: true,
    });
  }

  async findByUserId(
    userId: string,
    pagination: PaginationDTO
  ): Promise<PageResponse<ShareResponseDTO>> {
    const { page, limit } = pagination;

    const [items, total] = await this.shareRepo.findAndCount({
      where: { userId },
      relations: { post: true, shareStat: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = plainToInstance(ShareResponseDTO, items, {
      excludeExtraneousValues: true,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getSharesBatch(ids: string[]): Promise<ShareResponseDTO[]> {
    if (!ids.length) return [];

    const shares = await this.shareRepo
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.post', 'post')
      .where('share.id IN (:...ids)', { ids })
      .getMany();

    return plainToInstance(ShareResponseDTO, shares, {
      excludeExtraneousValues: true,
    });
  }
}
