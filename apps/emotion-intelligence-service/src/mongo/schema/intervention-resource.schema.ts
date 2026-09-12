import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TargetRiskLevel, InterventionMediaType } from '@repo/dtos';

export type InterventionResourceDocument = InterventionResource & Document;

export { TargetRiskLevel, InterventionMediaType };

@Schema({ timestamps: true, collection: 'intervention_resources' })
export class InterventionResource {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({
    type: [String],
    enum: TargetRiskLevel,
    default: [TargetRiskLevel.MODERATE_RISK, TargetRiskLevel.HIGH_RISK],
  })
  targetRiskLevels: TargetRiskLevel[];

  @Prop({ required: true, enum: InterventionMediaType })
  mediaType: InterventionMediaType;

  @Prop({ required: true })
  mediaUrl: string;

  @Prop()
  sourceOrganization?: string; // Tên đơn vị / tổ chức y khoa phát hành

  @Prop()
  referenceUrl?: string; // Đường dẫn tài liệu/bài báo y khoa kiểm chứng

  @Prop()
  thumbnailUrl?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  priority: number;
}

export const InterventionResourceSchema =
  SchemaFactory.createForClass(InterventionResource);
