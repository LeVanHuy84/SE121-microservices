import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MediaPreview } from './post-snapshot.schema';
import { Emotion } from '@repo/dtos';

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
  mainEmotion?: Emotion;

  @Prop()
  createdAt: Date;
}

@Schema({ _id: false })
export class StatsEmbedded {
  @Prop({ default: 0 }) reactions: number;
  @Prop({ default: 0 }) likes: number;
  @Prop({ default: 0 }) loves: number;
  @Prop({ default: 0 }) hahas: number;
  @Prop({ default: 0 }) wows: number;
  @Prop({ default: 0 }) angrys: number;
  @Prop({ default: 0 }) sads: number;
  @Prop({ default: 0 }) comments: number;
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

  @Prop({ type: StatsEmbedded, default: {} })
  stats: StatsEmbedded;
}

export type ShareSnapshotDocument = HydratedDocument<ShareSnapshot>;
export const ShareSnapshotSchema = SchemaFactory.createForClass(ShareSnapshot);
