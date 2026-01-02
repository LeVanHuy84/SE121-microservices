import { Expose } from 'class-transformer';

export class GroupReportResposeDTO {
  @Expose()
  id: string;

  @Expose()
  reporterId: string;

  @Expose()
  groupId: string;

  @Expose()
  reason: string;

  @Expose()
  createdAt: Date;
}
