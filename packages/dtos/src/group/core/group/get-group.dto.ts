import { Expose } from 'class-transformer';
import { GroupPrivacy, GroupStatus } from '../../enums';

export class GroupResponseDTO {
  @Expose()
  id: string;
  @Expose()
  name: string;
  @Expose()
  description?: string;
  @Expose()
  avatarUrl: string;
  @Expose()
  coverImageUrl: string;
  @Expose()
  privacy: GroupPrivacy;
  @Expose()
  rules?: string;
  @Expose()
  members: number;
  @Expose()
  status: GroupStatus;
  @Expose()
  createdAt: Date;
}
