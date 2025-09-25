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
import { Share } from 'src/entities/share.entity';
import { Repository } from 'typeorm';
import { UserService } from '../user/user.service';

@Injectable()
export class ShareService {
  constructor(
    @InjectRepository(Share)
    private readonly shareRepo: Repository<Share>,
    private readonly userService: UserService
  ) {}

  async sharePost(
    userId: string,
    dto: CreateShareDTO
  ): Promise<ShareResponseDTO> {
    const share = this.shareRepo.create({
      ...dto,
      userId,
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
      relations: ['post'],
    });

    if (!share) {
      throw new RpcException(`Share not found`);
    }

    const user = await this.userService.getUsersBatch([share.userId]);
    const response = plainToInstance(ShareResponseDTO, share, {
      excludeExtraneousValues: true,
    });
    response.user = user[share.userId];
    return response;
  }

  async findByUserId(
    userId: string,
    pagination: PaginationDTO
  ): Promise<PageResponse<ShareResponseDTO>> {
    const { page, limit } = pagination;

    const [items, total] = await this.shareRepo.findAndCount({
      where: { userId },
      relations: { post: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const userIds = [...new Set(items.map((p) => p.userId))];
    const users = await this.userService.getUsersBatch(userIds);

    const data = items.map((share) => {
      const dto = plainToInstance(ShareResponseDTO, share, {
        excludeExtraneousValues: true,
      });
      dto.user = users[share.userId];
      return dto;
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

    const userIds = [...new Set(shares.map((p) => p.userId))];
    const users = await this.userService.getUsersBatch(userIds);

    return shares.map((share) => {
      const dto = plainToInstance(ShareResponseDTO, share, {
        excludeExtraneousValues: true,
      });
      dto.user = users[share.userId];
      return dto;
    });
  }
}
