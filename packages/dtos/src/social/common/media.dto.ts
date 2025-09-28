import { Expose } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export class MediaDTO {
  @Expose()
  @IsOptional()
  @IsString({ each: true })
  imageUrls?: string[];

  @Expose()
  @IsOptional()
  @IsString({ each: true })
  videosUrls?: string[];
}
