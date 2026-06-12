import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CreateMusicFeatureDTO,
  MusicFeatureQueryDTO,
  PaginationDTO,
  SystemRole,
  UpdateMusicFeatureDTO,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { RequireRole } from 'src/common/decorators/require-role.decorator';
import { MusicAnalyzeService } from './music-analyze.service';

@Controller('musics')
export class MusicController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.MUSIC_SERVICE)
    private client: ClientProxy,
    private readonly musicAnalyzeService: MusicAnalyzeService,
  ) {}

  @Get('recommendations')
  getMusicRecommendations(
    @CurrentUserId() userId: string,
    @Query() query: PaginationDTO,
  ) {
    console.log('Received query in controller:', query);
    return this.client.send('get_music_recommendations', { userId, query });
  }

  @Post('analyze')
  @RequireRole(SystemRole.ADMIN)
  analyzeMusic(@Body('url') url: string) {
    return this.musicAnalyzeService.analyzeMusic(url);
  }

  @Post()
  @RequireRole(SystemRole.ADMIN)
  createMusicFeature(@Body() dto: CreateMusicFeatureDTO) {
    console.log('Received DTO in controller:', dto);
    return this.client.send('create_music_feature', dto);
  }

  @Patch(':id')
  @RequireRole(SystemRole.ADMIN)
  updateMusicFeature(
    @Param('id') id: string,
    @Body() dto: UpdateMusicFeatureDTO,
  ) {
    return this.client.send('update_music_feature', { id, dto });
  }

  @Delete(':id')
  @RequireRole(SystemRole.ADMIN)
  deleteMusicFeature(@Param('id') id: string) {
    return this.client.send('delete_music_feature', id);
  }

  @Get(':id')
  getMusicFeature(@Param('id') id: string) {
    return this.client.send('get_music_feature', id);
  }

  @Get()
  listMusicFeatures(@Query() query: MusicFeatureQueryDTO) {
    return this.client.send('list_music_features', query);
  }
}
