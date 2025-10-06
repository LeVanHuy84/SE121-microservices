export enum ReactionType {
  LIKE,
  LOVE,
  HAHA,
  WOW,
  SAD,
  ANGRY,
}

export enum RootTargetType {
  POST,
  SHARE,
}

export enum TargetType {
  POST,
  COMMENT,
  SHARE,
}

export enum Audience {
  PUBLIC,
  FRIENDS,
  ONLY_ME,
}

export enum PostStatus {
  ACTIVE,
  DELETED,
  HIDDEN,
}

export enum Feeling {
  JOY,
  SADNESS,
  ANGER,
  FEAR,
  DISGUST,
}

export enum EventType {
  POST = 'POST',
  COMMENT = 'COMMENT',
  SHARE = 'SHARE',
  REACT = 'REACT',
}

export enum MediaType {
  IMAGE,
  VIDEO,
}
