// constants/privacy-level.ts
export const PRIVACY_LEVEL = {
  PUBLIC: 'public',
  PRIVATE: 'private',
} as const;

export const EVENT_DESTINATION = {
  KAFKA: 'KAFKA',
  RABBITMQ: 'RABBITMQ',
} as const;

export const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  BANNED: 'BANNED',
} as const;
