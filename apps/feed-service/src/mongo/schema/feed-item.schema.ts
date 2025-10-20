import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { FeedEventType } from '@repo/dtos';

@Schema({ collection: 'feed_items', timestamps: true })
export class FeedItem {
  _id?: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string; // feed của user nào

  @Prop({ required: true })
  snapshotId: string; // tham chiếu tới post_snapshot hoặc share_snapshot

  @Prop({ required: true, enum: FeedEventType })
  eventType: FeedEventType;

  @Prop()
  refId: string; // tham chiếu tới postId hoặc shareId

  @Prop({ default: 0, index: true })
  rankingScore: number;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export type FeedItemDocument = HydratedDocument<FeedItem>;
export const FeedItemSchema = SchemaFactory.createForClass(FeedItem);
