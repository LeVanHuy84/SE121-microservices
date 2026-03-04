import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { FeedEventType } from '@repo/dtos';

@Schema({ collection: 'feed_items', timestamps: true })
export class FeedItem {
  _id?: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string; // feed của user nào

  @Prop({ required: true, enum: FeedEventType })
  eventType: FeedEventType; // POST | SHARE

  // snapshot id tương ứng
  @Prop({ required: true })
  snapshotId: string;

  // QUAN TRỌNG: luôn có postId cho ranking
  @Prop({ required: true, index: true })
  postId: string;

  // ref gốc (postId hoặc shareId)
  @Prop({ required: true })
  refId: string;

  @Prop({ default: 0, index: true })
  rankingScore: number;

  @Prop({ index: true })
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export type FeedItemDocument = HydratedDocument<FeedItem>;
export const FeedItemSchema = SchemaFactory.createForClass(FeedItem);
