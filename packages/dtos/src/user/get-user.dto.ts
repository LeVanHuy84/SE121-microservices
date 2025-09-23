import { Expose } from 'class-transformer';

export class UserResponseDTO {
  @Expose()
  id: string;
  @Expose()
  email: string;
  @Expose()
  isActive: boolean;
  @Expose()
  firstName: string;
  @Expose()
  lastName: string;
  @Expose()
  coverImageUrl: string;
  @Expose()
  avatarUrl: string;
  @Expose()
  bio: string;
  @Expose()
  createdAt: Date
}
