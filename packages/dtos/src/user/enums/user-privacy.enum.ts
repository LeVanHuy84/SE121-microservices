export enum PrivacyLevel {
  PUBLIC = 'PUBLIC',
  FRIENDS = 'FRIENDS',
  PRIVATE = 'PRIVATE',
}

export enum MessagePrivacy {
  EVERYONE = 'EVERYONE',
  FRIENDS = 'FRIENDS',
}

export interface UserPrivacySettings {
  profileVisibility: PrivacyLevel;
  messagePrivacy: MessagePrivacy;
  friendListVisibility: PrivacyLevel;
}
