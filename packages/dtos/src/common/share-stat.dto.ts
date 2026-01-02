import { Expose } from 'class-transformer';

export class ShareStatDTO {
  @Expose() reactions: number;
  @Expose() likes: number;
  @Expose() loves: number;
  @Expose() hahas: number;
  @Expose() wows: number;
  @Expose() angrys: number;
  @Expose() sads: number;
  @Expose() comments: number;
}
