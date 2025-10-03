import { Expose } from 'class-transformer';
import { IsIn, IsString } from 'class-validator';

export class MediaItemDTO {
  @Expose()
  @IsIn(['image', 'video'])
  type: 'image' | 'video';

  @Expose()
  @IsString()
  url: string;
}
