import { Expose } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MediaType } from './enum';

export class MediaItemDTO {
  @Expose()
  @IsEnum(MediaType)
  type: MediaType;

  @Expose()
  @IsString()
  url: string;

  @Expose()
  @IsOptional()
  @IsString()
  publicId?: string;

  @Expose()
  @IsOptional()
  @IsString()
  fileName?: string;

  @Expose()
  @IsOptional()
  @IsString()
  mimeType?: string;

  @Expose()
  @IsOptional()
  size?: number;

  @Expose()
  @IsOptional()
  duration?: number;

  @Expose()
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;
}
