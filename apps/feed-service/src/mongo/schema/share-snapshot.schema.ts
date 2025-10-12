import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MediaPreview } from './post-snapshot.schema';

@Schema({ _id: false })
export class PostSnapshotEmbedded {
  @Prop({ required: true })
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
}

@Schema({ collection: 'share_snapshots', timestamps: true })
export class ShareSnapshot {
  _id?: Types.ObjectId;

  @Prop({ required: true, unique: true })
  shareId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ type: PostSnapshotEmbedded })
  post: PostSnapshotEmbedded;

  @Prop()
  content: string;

  @Prop()
  shareCreatedAt: Date;
}

export type ShareSnapshotDocument = HydratedDocument<ShareSnapshot>;
export const ShareSnapshotSchema = SchemaFactory.createForClass(ShareSnapshot);
