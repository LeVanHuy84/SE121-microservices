import { Expose } from 'class-transformer';
import { IsString } from 'class-validator';
import { Emotion } from '../../social';

export class ReactMessageDTO {
  @Expose()
  userId: string;

  @Expose()
  emotion: Emotion;

  @Expose()
  createdAt: Date;
}
