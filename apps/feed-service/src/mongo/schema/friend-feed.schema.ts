import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FriendFeedDocument = FriendFeed & Document;

@Schema({ collection: 'friend_feeds', timestamps: true })
export class FriendFeed {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({
    type: [
      {
        friendId: { type: String, required: true },
        closenessScore: { type: Number, default: 0 },
        lastInteraction: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  friends: {
    friendId: string;
    closenessScore: number;
    lastInteraction: Date;
  }[];
}

export const FriendFeedSchema = SchemaFactory.createForClass(FriendFeed);
