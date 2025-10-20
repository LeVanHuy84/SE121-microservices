import { ReactionType } from '@repo/dtos';

export const ReactionFieldMap: Record<ReactionType, string> = {
  [ReactionType.LIKE]: 'likes',
  [ReactionType.LOVE]: 'loves',
  [ReactionType.HAHA]: 'hahas',
  [ReactionType.WOW]: 'wows',
  [ReactionType.SAD]: 'sads',
  [ReactionType.ANGRY]: 'angrys',
};

export const MICROSERVICES_CLIENT = {
  USER_SERVICE: 'USER_SERVICE',
  REDIS_CLIENT: 'REDIS_CLIENT',
  KAFKA_PRODUCER: 'KAFKA_PRODUCER',
};
