import { Expose } from 'class-transformer';
import { LogType } from '../enums';

export class AuditLogResponseDTO {
  @Expose()
  id: string;
  @Expose()
  actorId: string;
  @Expose()
  targetId: string;
  @Expose()
  logType: LogType;
  @Expose()
  action: string;
  @Expose()
  detail: string;
  @Expose()
  createdAt: Date;
}
