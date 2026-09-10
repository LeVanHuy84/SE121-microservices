import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Audience, MediaType, ModerationAction } from "@repo/dtos";
import { HydratedDocument, Types } from "mongoose";

@Schema({ _id: false })
export class MediaPreview {
  @Prop({ enum: MediaType, required: true })
  type: MediaType;

  @Prop({ required: true })
  url: string;
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
  @Prop({ default: 0 }) shares: number;
}

@Schema({ _id: false })
export class EmotionFeature {
  @Prop()
  primaryEmotion?: string;

  @Prop({ type: [String], default: [] })
  secondaryEmotions?: string[];

  /**
   * @deprecated Legacy label.
   */
  @Prop()
  label?: string;

  @Prop({ required: true })
  confidence: number;

  @Prop({ type: Map, of: Number })
  scores?: Record<string, number>;

  @Prop({ default: false })
  isSarcasmOrConflict?: boolean;

  @Prop({ default: "none" })
  mentalHealthRiskLevel?: string;
}

@Schema({ collection: "post_snapshots", timestamps: true })
export class PostSnapshot {
  _id?: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  postId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop()
  groupId?: string;

  @Prop()
  audience: Audience;

  @Prop()
  content?: string;

  @Prop({ type: [MediaPreview], default: [] })
  mediaPreviews: MediaPreview[];

  @Prop({ default: 0 })
  mediaRemaining: number;

  // SINGLE SOURCE OF TRUTH cho emotion
  @Prop({ type: EmotionFeature })
  emotionFeature?: EmotionFeature;

  // === MODERATION FLAGS DÀNH CHO FEED RENDER UI ===
  @Prop({
    type: String,
    enum: ModerationAction,
    default: ModerationAction.ALLOW,
  })
  moderationAction: ModerationAction;

  @Prop({ default: false })
  hasWarning: boolean;

  @Prop()
  warningReason?: string;

  @Prop({ default: false })
  needsMentalSupport: boolean;

  @Prop({ required: true, index: true })
  postCreatedAt: Date;

  @Prop({ type: StatsEmbedded, default: {} })
  stats: StatsEmbedded;
}

export type PostSnapshotDocument = HydratedDocument<PostSnapshot>;
export const PostSnapshotSchema = SchemaFactory.createForClass(PostSnapshot);
