import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { MusicFeature } from 'src/entities/music-feature.entity';
import { ILike, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  CreateMusicFeatureDTO,
  MusicFeatureQueryDTO,
  MusicFeatureResponse,
  PageResponse,
  UpdateMusicFeatureDTO,
} from '@repo/dtos';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(MusicFeature)
    private readonly musicFeatureRepo: Repository<MusicFeature>,
  ) {}

  async createMusicFeature(dto: CreateMusicFeatureDTO) {
    const musicFeature = this.musicFeatureRepo.create(dto);
    await this.musicFeatureRepo.save(musicFeature);

    return true;
  }

  async updateMusicFeature(id: string, dto: UpdateMusicFeatureDTO) {
    const musicFeature = await this.musicFeatureRepo.findOneBy({ id });
    if (!musicFeature) {
      throw new RpcException({
        statusCode: 404,
        message: 'Post not found',
      });
    }

    Object.assign(musicFeature, dto);
    await this.musicFeatureRepo.save(musicFeature);
    return true;
  }

  async getMusicFeature(id: string): Promise<MusicFeatureResponse> {
    const musicFeature = await this.musicFeatureRepo.findOneBy({ id });
    if (!musicFeature) {
      throw new RpcException({
        statusCode: 404,
        message: 'Post not found',
      });
    }
    return plainToInstance(MusicFeatureResponse, musicFeature);
  }

  async deleteMusicFeature(id: string) {
    const musicFeature = await this.musicFeatureRepo.findOneBy({ id });
    if (!musicFeature) {
      throw new RpcException({
        statusCode: 404,
        message: 'Post not found',
      });
    }

    await this.musicFeatureRepo.delete({ id });
    return true;
  }

  async getMusicFeatures(
    query: MusicFeatureQueryDTO,
  ): Promise<PageResponse<MusicFeatureResponse>> {
    const { search, genre, page = 1, limit = 10 } = query;
    const [features, total] = await this.musicFeatureRepo.findAndCount({
      where: {
        ...(search && {
          OR: [
            { title: ILike(`%${search}%`) },
            { artist: ILike(`%${search}%`) },
          ],
        }),
        ...(genre && { genre }),
      },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return new PageResponse(
      features.map((feature) => plainToInstance(MusicFeatureResponse, feature)),
      total,
      page,
      limit,
    );
  }
}
