import { Expose, Type } from 'class-transformer';
import { AiAssistantPolicy, PrivacyLevel, MessagePrivacy } from './enums';

export class UserPrivacySettingsResponse {
  @Expose()
  profileVisibility: PrivacyLevel;
  
  @Expose()
  messagePrivacy: MessagePrivacy;
  
  @Expose()
  friendListVisibility: PrivacyLevel;

  @Expose()
  allowProactiveIntervention?: boolean;

  @Expose()
  aiPolicy?: AiAssistantPolicy;
}

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
  location?: string;
  @Expose()
  jobTitle?: string;
  @Expose()
  company?: string;
  @Expose()
  school?: string;
  @Expose()
  interests?: string[];
  @Expose()
  createdAt: Date;

  @Expose()
  postCount: number;

  @Expose()
  friendCount: number;

  @Expose()
  @Type(() => UserPrivacySettingsResponse)
  privacySettings: UserPrivacySettingsResponse;
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
