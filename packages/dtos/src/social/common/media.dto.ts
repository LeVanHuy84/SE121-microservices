import { Expose } from 'class-transformer';
import { IsEnum, IsIn, IsString } from 'class-validator';
import { MediaType } from '../enums/social.enum';

export class MediaItemDTO {
  @Expose()
  @IsEnum(MediaType)
  type: MediaType;

  @Expose()
  @IsString()
  url: string;
}
