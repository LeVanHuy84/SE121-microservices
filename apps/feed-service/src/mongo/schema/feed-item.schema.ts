import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { EventType } from '@repo/dtos';

@Schema({ collection: 'feed_items', timestamps: true })
export class FeedItem extends Document {
  @Prop({ required: true, index: true })
  userId: string; // feed của user nào

  @Prop({ required: true })
  snapshotId: string; // tham chiếu tới post_snapshot

  @Prop({ required: true, enum: EventType })
  eventType: string;

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ default: 0, index: true })
  rankingScore: number;
}

export const FeedItemSchema = SchemaFactory.createForClass(FeedItem);
