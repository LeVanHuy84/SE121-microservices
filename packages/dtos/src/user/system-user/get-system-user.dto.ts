import { Expose } from 'class-transformer';
import { SystemRole, UserStatus } from '../enums';

export class SystemUserDTO {
  @Expose()
  id: string;
  @Expose()
  email: string;
  @Expose()
  firstName: string;
  @Expose()
  lastName: string;
  @Expose()
  role: SystemRole;
  @Expose()
  status: UserStatus;
  @Expose()
  createdAt: Date;
}
