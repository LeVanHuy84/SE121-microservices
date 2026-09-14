import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  InterventionHotlineInfoDetailsDto,
  InterventionResourceItemDto,
  MusicSuggestionItemDto,
  RiskLevel,
  TriggerFlag,
} from '@repo/dtos';

export type InterventionLogDocument = InterventionLog & Document;

export enum TriggerSource {
  REALTIME_EVENT = 'REALTIME_EVENT',
  PASSIVE_CRON = 'PASSIVE_CRON',
}

@Schema({ collection: 'intervention_logs', timestamps: true })
export class InterventionLog {
  _id?: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, type: String, enum: RiskLevel })
  riskLevel: RiskLevel;

  @Prop({ required: true })
  riskScore: number;

  @Prop({ type: [String], default: [] })
  triggers: TriggerFlag[];

  @Prop({ required: true })
  suggestedAction: string;

  @Prop({ type: Object })
  resourceDetails?: InterventionResourceItemDto;

  @Prop({ type: Object })
  hotlineDetails?: InterventionHotlineInfoDetailsDto;

  @Prop({ type: [Object], default: [] })
  musicSuggestions?: MusicSuggestionItemDto[];

  @Prop()
  chatbotPromptContext?: string;

  @Prop({ type: String, enum: TriggerSource, default: TriggerSource.REALTIME_EVENT })
  triggerSource: TriggerSource;
}

export const InterventionLogSchema = SchemaFactory.createForClass(InterventionLog);

InterventionLogSchema.index({ userId: 1, createdAt: -1 });
