import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CreateShareDTO,
  PageResponse,
  PaginationDTO,
  ShareResponseDTO,
  UpdateShareDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { ShareStat } from 'src/entities/share-stat.entity';
import { Share } from 'src/entities/share.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ShareService {
  constructor(
    @InjectRepository(Share) private readonly shareRepo: Repository<Share>,
    @InjectRepository(ShareStat)
    private readonly shareStatRepo: Repository<ShareStat>
  ) {}

  async sharePost(
    userId: string,
    dto: CreateShareDTO
  ): Promise<ShareResponseDTO> {
    const share = this.shareRepo.create({
      ...dto,
      userId,
      shareStat: this.shareStatRepo.create(),
    });
    const entity = await this.shareRepo.save(share);
    return plainToInstance(ShareResponseDTO, entity, {
      excludeExtraneousValues: true,
    });
  }

  async update(
    userId: string,
    shareId: string,
    dto: UpdateShareDTO
  ): Promise<ShareResponseDTO> {
    const share = await this.shareRepo.findOneBy({ id: shareId });
    if (!share) throw new RpcException('Share not found with id: ' + shareId);
    if (share.userId !== userId)
      throw new RpcException('You are not authorized to update this post');

    Object.assign(share, dto);
    const updatedShare = await this.shareRepo.save(share);

    return plainToInstance(ShareResponseDTO, updatedShare, {
      excludeExtraneousValues: true,
    });
  }

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

  async remove(userId: string, shareId: string) {
    const share = await this.shareRepo.findOneBy({ id: shareId });
    if (!share) {
      throw new RpcException('Share not found with id: ' + shareId);
    }
    if (share.userId !== userId) {
      throw new RpcException('You are not authorized to delete this share');
    }
    await this.shareRepo.delete({ id: shareId });
    return { success: true };
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
