import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class MediaPreview {
  type: 'image' | 'video';
  url: string;
}

@Schema({ collection: 'post_snapshots', timestamps: true })
export class PostSnapshot extends Document {
  @Prop({ required: true })
  postId: string;

  @Prop({ required: true })
  userId: string;

  @Prop()
  groupId?: string;

  @Prop()
  contentSnippet: string;

  @Prop({ type: Object })
  mediaPreviews: MediaPreview[];

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const PostSnapshotSchema = SchemaFactory.createForClass(PostSnapshot);
