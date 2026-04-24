import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { MusicFeature } from 'src/entities/music-feature.entity';
import { ILike, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  CreateMusicFeatureDTO,
  InternalMusicQueryDto,
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

  async createMusicFeature(dto: CreateMusicFeatureDTO): Promise<MusicFeatureResponse> {
    const musicFeature = this.musicFeatureRepo.create(dto);
    await this.musicFeatureRepo.save(musicFeature);

    return plainToInstance(MusicFeatureResponse, musicFeature);
  }

  async updateMusicFeature(id: string, dto: UpdateMusicFeatureDTO): Promise<MusicFeatureResponse> {
    const musicFeature = await this.musicFeatureRepo.findOneBy({ id });
    if (!musicFeature) {
      throw new RpcException({
        statusCode: 404,
        message: 'Post not found',
      });
    }

    Object.assign(musicFeature, dto);
    await this.musicFeatureRepo.save(musicFeature);
    return plainToInstance(MusicFeatureResponse, musicFeature);
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

async queryForRecommendation(
  dto: InternalMusicQueryDto,
): Promise<[MusicFeatureResponse[], number]> {
  const limit = dto.limit ?? 50;
  const offset = dto.offset ?? 0;

  const queryBuilder = this.musicFeatureRepo
    .createQueryBuilder('musicFeature')
    .select([
      'musicFeature.id',
      'musicFeature.audio',
      'musicFeature.coverImage',
      'musicFeature.artist',
      'musicFeature.title',
      'musicFeature.genre',
      'musicFeature.valence',
      'musicFeature.arousal',
      'musicFeature.createdAt',
    ])
    .take(limit)
    .skip(offset);

  // FILTER
  if (dto.valenceMin !== undefined) {
    queryBuilder.andWhere('musicFeature.valence >= :valenceMin', {
      valenceMin: dto.valenceMin,
    });
  }

  if (dto.valenceMax !== undefined) {
    queryBuilder.andWhere('musicFeature.valence <= :valenceMax', {
      valenceMax: dto.valenceMax,
    });
  }

  if (dto.arousalMin !== undefined) {
    queryBuilder.andWhere('musicFeature.arousal >= :arousalMin', {
      arousalMin: dto.arousalMin,
    });
  }

  if (dto.arousalMax !== undefined) {
    queryBuilder.andWhere('musicFeature.arousal <= :arousalMax', {
      arousalMax: dto.arousalMax,
    });
  }

  // SORT
  if (dto.sortByDistanceTo) {
    const wV = dto.sortByDistanceTo.weightValence ?? 0.5;
    const wA = dto.sortByDistanceTo.weightArousal ?? 0.5;

    queryBuilder.orderBy(
      `
      (${wV} * POWER(musicFeature.valence - :v, 2)) +
      (${wA} * POWER(musicFeature.arousal - :a, 2))
      `,
      'ASC',
    );

    queryBuilder.addOrderBy('RANDOM()', 'ASC');

    queryBuilder.setParameters({
      v: dto.sortByDistanceTo.valence,
      a: dto.sortByDistanceTo.arousal,
    });
  } else {
    queryBuilder.orderBy('musicFeature.createdAt', 'DESC');
  }

  const [features, total] = await queryBuilder.getManyAndCount();

  return [
    features.map((f) => plainToInstance(MusicFeatureResponse, f)),
    total,
  ];
}
}
