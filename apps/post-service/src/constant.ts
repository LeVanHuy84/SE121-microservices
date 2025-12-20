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

export const TARGET_CONFIG = {
  POST: {
    table: 'posts',
    statsTable: 'post_stats',
    alias: 'p',
    statsAlias: 'ps',
    statId: 'postId',
  },
  COMMENT: {
    table: 'comments',
    statsTable: 'comment_stats',
    alias: 'c',
    statsAlias: 'cs',
    statId: 'commentId',
  },
  SHARE: {
    table: 'shares',
    statsTable: 'share_stats',
    alias: 's',
    statsAlias: 'ss',
    statId: 'shareId',
  },
} as const;
