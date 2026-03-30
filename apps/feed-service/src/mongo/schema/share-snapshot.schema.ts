import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Audience } from '@repo/dtos';

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

  @Prop({ required: true, unique: true, index: true })
  shareId: string;

  @Prop({ required: true, index: true })
  userId: string;

  // QUAN TRỌNG: ranking sẽ dùng field này
  @Prop({ required: true, index: true })
  postId: string;

  @Prop()
  audience?: Audience;

  // caption của share
  @Prop()
  content?: string;

  @Prop({ required: true, index: true })
  shareCreatedAt: Date;

  @Prop({ type: StatsEmbedded, default: {} })
  stats: StatsEmbedded;
}

export type ShareSnapshotDocument = HydratedDocument<ShareSnapshot>;
export const ShareSnapshotSchema = SchemaFactory.createForClass(ShareSnapshot);
