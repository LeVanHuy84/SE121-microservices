import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CatalogService } from './catalog.service';
import { CreateMusicFeatureDTO, UpdateMusicFeatureDTO } from '@repo/dtos';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @MessagePattern('create-music-feature')
  createMusicFeature(@Payload() payload: CreateMusicFeatureDTO) {
    this.catalogService.createMusicFeature(payload);
  }

  @MessagePattern('update-music-feature')
  updateMusicFeature(
    @Payload() payload: { id: string; dto: UpdateMusicFeatureDTO },
  ) {
    this.catalogService.updateMusicFeature(payload.id, payload.dto);
  }

  @MessagePattern('delete-music-feature')
  deleteMusicFeature(@Payload() id: string) {
    this.catalogService.deleteMusicFeature(id);
  }

  @MessagePattern('get-music-feature')
  getMusicFeature(@Payload() id: string) {
    return this.catalogService.getMusicFeature(id);
  }
}
