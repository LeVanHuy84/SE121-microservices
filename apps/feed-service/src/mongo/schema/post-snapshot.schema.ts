import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class MediaPreview {
  @Prop({ required: true })
  type: number;

  @Prop({ required: true })
  url: string;
}

@Schema({ collection: 'post_snapshots', timestamps: true })
export class PostSnapshot extends Document {
  @Prop({ required: true, unique: true })
  postId: string;

  @Prop({ required: true })
  userId: string;

  @Prop()
  groupId?: string;

  @Prop()
  content: string;

  @Prop({ type: [MediaPreview], default: [] })
  mediaPreviews: MediaPreview[];

  @Prop({ default: 0 })
  mediaRemaining: number;

  @Prop()
  createdAt: Date;

  @Prop({ default: Date.now })
  timeStamp: Date;
}

export const PostSnapshotSchema = SchemaFactory.createForClass(PostSnapshot);
