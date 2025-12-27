import { ReactionType, TargetType } from '@repo/dtos';

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
  [TargetType.POST]: {
    table: 'posts',
    statsTable: 'post_stats',
    alias: 'p',
    statsAlias: 'ps',
    statId: 'postId',
  },
  [TargetType.COMMENT]: {
    table: 'comments',
    statsTable: 'comment_stats',
    alias: 'c',
    statsAlias: 'cs',
    statId: 'commentId',
  },
  [TargetType.SHARE]: {
    table: 'shares',
    statsTable: 'share_stats',
    alias: 's',
    statsAlias: 'ss',
    statId: 'shareId',
  },
} as const;

export const CONTENT_TYPE_VN: Record<TargetType, string> = {
  [TargetType.POST]: 'bài viết',
  [TargetType.COMMENT]: 'bình luận',
  [TargetType.SHARE]: 'chia sẻ',
};
