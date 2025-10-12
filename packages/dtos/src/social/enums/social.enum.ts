export enum ReactionType {
  LIKE,
  LOVE,
  HAHA,
  WOW,
  SAD,
  ANGRY,
}

export enum RootType {
  POST,
  SHARE,
}

export enum TargetType {
  POST,
  SHARE,
  COMMENT,
}

export enum Audience {
  PUBLIC,
  FRIENDS,
  ONLY_ME,
}

export enum Emotion {
  JOY = 'JOY',
  SADNESS = 'SADNESS',
  ANGER = 'ANGER',
  FEAR = 'FEAR',
  DISGUST = 'DISGUST',
  SURPRISE = 'SURPRISE',
  NEUTRAL = 'NEUTRAL',
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
