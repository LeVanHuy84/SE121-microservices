import { Expose } from 'class-transformer';
import { ReportStatus, TargetType } from '../enums';

export class ReportResponseDTO {
  @Expose()
  id: string;
  @Expose()
  groupId: string;
  @Expose()
  reporterId: string;
  @Expose()
  targetType: TargetType;
  @Expose()
  targetId: string;
  @Expose()
  reason: string;
  @Expose()
  status: ReportStatus;
  @Expose()
  createdAt: Date;
}
