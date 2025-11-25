// constants/privacy-level.ts
export const PRIVACY_LEVEL = {
  PUBLIC: 'public',
  PRIVATE: 'private',
} as const;

export const EVENT_DESTINATION = {
  KAFKA: 'KAFKA',
  RABBITMQ: 'RABBITMQ',
} as const;
