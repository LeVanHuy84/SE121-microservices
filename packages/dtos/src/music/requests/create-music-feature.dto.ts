import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MusicGenre } from '../enum';
import { MediaItemDTO } from '../../common';

export class AudioDTO {
  @IsString()
  url: string;

  @IsString()
  publicId: string;

  @IsOptional()
  duration?: number;
}

export class CreateMusicFeatureDTO {
  @ValidateNested()
  @Type(() => AudioDTO)
  audio: AudioDTO;

  @ValidateNested()
  @Type(() => MediaItemDTO)
  coverImage: MediaItemDTO;

  @IsString()
  @IsOptional()
  artist?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsEnum(MusicGenre)
  genre?: MusicGenre;

  // ===== EMOTION =====
  @IsNumber()
  valence: number;

  @IsNumber()
  arousal: number;
}
