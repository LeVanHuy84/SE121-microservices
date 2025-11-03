import { Expose } from 'class-transformer';
import { Audience } from '../enums/social.enum';

export class SharePreviewDTO {
  @Expose()
  shareId: string;

  @Expose()
  userId: string;

  @Expose()
  audience?: Audience;

  @Expose()
  content?: string;

  @Expose()
  createdAt: Date;
}
