export enum PrivacyLevel {
  PUBLIC = 'PUBLIC',
  FRIENDS = 'FRIENDS',
  PRIVATE = 'PRIVATE',
}

export enum MessagePrivacy {
  EVERYONE = 'EVERYONE',
  FRIENDS = 'FRIENDS',
}

export enum AiAssistantPolicy {
  FULL = 'FULL',
  RESTRICTED = 'RESTRICTED',
}

export interface UserPrivacySettings {
  profileVisibility: PrivacyLevel;
  messagePrivacy: MessagePrivacy;
  friendListVisibility: PrivacyLevel;
  allowProactiveIntervention?: boolean;
  aiPolicy?: AiAssistantPolicy;
}
