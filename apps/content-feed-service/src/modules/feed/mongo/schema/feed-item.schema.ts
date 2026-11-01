import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { FeedEventType } from "@repo/dtos";

@Schema({ collection: "feed_items", timestamps: true })
export class FeedItem {
  _id?: Types.ObjectId;

  @Prop({ required: true, type: String, index: true })
  userId: string; // feed của user nào

  @Prop({ required: true, type: String, enum: FeedEventType })
  eventType: FeedEventType; // POST | SHARE

  // snapshot id tương ứng
  @Prop({ required: true, type: String })
  snapshotId: string;

  // QUAN TRỌNG: luôn có postId cho ranking
  @Prop({ required: true, type: String, index: true })
  postId: string;

  @Prop({ type: String, index: true })
  emotionLabel?: string; // optional

  // ref gốc (postId hoặc shareId)
  @Prop({ required: true, type: String })
  refId: string;

  @Prop({ type: Date, index: true })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export type FeedItemDocument = HydratedDocument<FeedItem>;
export const FeedItemSchema = SchemaFactory.createForClass(FeedItem);
FeedItemSchema.index({ userId: 1, createdAt: -1 });
FeedItemSchema.index({ userId: 1, emotionLabel: 1, createdAt: -1 });
