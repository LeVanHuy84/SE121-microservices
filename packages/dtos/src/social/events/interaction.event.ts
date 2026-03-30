import { RootType } from '../enums';

export enum InteractionType {
  REACT = 'REACT',
  COMMENT = 'COMMENT',
  SHARE = 'SHARE',
}

export class InteractionEventPayload {
  userId: string;
  targetId: string;
  targetType: RootType;
  interactionType: InteractionType;
  createdAt: Date;
}
