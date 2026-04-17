import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MusicFeature } from 'src/entities/music-feature.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MusicFeature])],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
