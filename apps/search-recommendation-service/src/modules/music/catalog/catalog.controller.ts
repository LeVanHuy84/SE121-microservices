import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { CatalogService } from './catalog.service';
import {
  CreateMusicFeatureDTO,
  MusicFeatureQueryDTO,
  MusicFeatureResponse,
  PageResponse,
  UpdateMusicFeatureDTO,
} from '@repo/dtos';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @TcpMessagePattern('create_music_feature')
  createMusicFeature(
    @Payload() payload: CreateMusicFeatureDTO,
  ): Promise<MusicFeatureResponse> {
    return this.catalogService.createMusicFeature(payload);
  }

  @TcpMessagePattern('update_music_feature')
  updateMusicFeature(
    @Payload() payload: { id: string; dto: UpdateMusicFeatureDTO },
  ): Promise<MusicFeatureResponse> {
    return this.catalogService.updateMusicFeature(payload.id, payload.dto);
  }

  @TcpMessagePattern('delete_music_feature')
  deleteMusicFeature(@Payload() id: string): Promise<boolean> {
    return this.catalogService.deleteMusicFeature(id);
  }

  @TcpMessagePattern('get_music_feature')
  getMusicFeature(@Payload() id: string): Promise<MusicFeatureResponse> {
    return this.catalogService.getMusicFeature(id);
  }

  @TcpMessagePattern('list_music_features')
  listMusicFeatures(
    @Payload() query: MusicFeatureQueryDTO,
  ): Promise<PageResponse<MusicFeatureResponse>> {
    return this.catalogService.getMusicFeatures(query);
  }
}
