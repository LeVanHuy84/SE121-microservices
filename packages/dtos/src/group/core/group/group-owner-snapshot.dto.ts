import { Expose } from 'class-transformer';

export class GroupOwnerSnapshot {
  @Expose()
  id: string;

  @Expose()
  fullName: string;

  @Expose()
  avatarUrl?: string;
}
