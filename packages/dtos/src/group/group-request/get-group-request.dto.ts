import { Expose } from 'class-transformer';
import { InviteStatus } from '../enums';

export class JoinRequestResponseDTO {
  @Expose()
  id: string;

  @Expose()
  groupId: string;

  @Expose()
  inviterId: string;

  @Expose()
  inviteeId: string;

  @Expose()
  status: InviteStatus;
}
