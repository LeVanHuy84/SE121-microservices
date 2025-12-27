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
  coverImage?: {
    url?: string;
    publicId?: string;
  };
  @Expose()
  avatarUrl: string;
  @Expose()
  bio: string;
  @Expose()
  createdAt: Date;
}

export class BaseUserDTO {
  @Expose()
  id: string;
  @Expose()
  firstName: string;
  @Expose()
  lastName: string;
  @Expose()
  avatarUrl: string;
}
