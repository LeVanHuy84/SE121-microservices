import { Expose } from 'class-transformer';

export class GroupLogResponseDTO {
  @Expose()
  id: string;

  @Expose()
  groupId: string;

  @Expose()
  userId: string;

  @Expose()
  eventType: string;

  @Expose()
  content: string;

  @Expose()
  createdAt: Date;
}
