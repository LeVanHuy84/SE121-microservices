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
}
