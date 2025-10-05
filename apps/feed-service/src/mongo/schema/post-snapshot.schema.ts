import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { MediaType } from '@repo/dtos';
import { Document } from 'mongoose';

export class MediaPreview {
  type: MediaType;
  url: string;
}

@Schema({ collection: 'post_snapshots', timestamps: true })
export class PostSnapshot extends Document {
  @Prop({ required: true })
  postId: string;

  @Prop({ required: true, unique: true })
  userId: string;

  @Prop()
  groupId?: string;

  @Prop()
  contentSnippet: string;

  @Prop({ type: Object })
  mediaPreviews: MediaPreview[];

  @Prop()
  createdAt: Date;

  @Prop({ default: Date.now })
  timeStamp: Date;
}

export const PostSnapshotSchema = SchemaFactory.createForClass(PostSnapshot);
