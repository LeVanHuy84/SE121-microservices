import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
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

  @MessagePattern('create_music_feature')
  createMusicFeature(@Payload() payload: CreateMusicFeatureDTO): Promise<MusicFeatureResponse> {
    return this.catalogService.createMusicFeature(payload);
  }

  @MessagePattern('update_music_feature')
  updateMusicFeature(
    @Payload() payload: { id: string; dto: UpdateMusicFeatureDTO },
  ): Promise<MusicFeatureResponse> {
    return this.catalogService.updateMusicFeature(payload.id, payload.dto);
  }

  @MessagePattern('delete_music_feature')
  deleteMusicFeature(@Payload() id: string): Promise<boolean> {
    return this.catalogService.deleteMusicFeature(id);
  }

  @MessagePattern('get_music_feature')
  getMusicFeature(@Payload() id: string): Promise<MusicFeatureResponse> {
    return this.catalogService.getMusicFeature(id);
  }

  @MessagePattern('list_music_features')
  listMusicFeatures(@Payload() query: MusicFeatureQueryDTO): Promise<PageResponse<MusicFeatureResponse>> {
    return this.catalogService.getMusicFeatures(query);
  }
}
