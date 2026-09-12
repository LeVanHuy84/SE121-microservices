import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmergencyHotlineDocument = EmergencyHotline & Document;

@Schema({ timestamps: true, collection: 'emergency_hotlines' })
export class EmergencyHotline {
  @Prop({ required: true })
  organizationName: string;

  @Prop({ required: true })
  hotlineNumber: string;

  @Prop({ default: true })
  is247: boolean;

  @Prop({ default: '24/7' })
  operatingHours?: string;

  @Prop({ type: Object })
  operatingHoursConfig?: {
    is247?: boolean;
    startTime?: string;
    endTime?: string;
    daysOfWeek?: number[];
    timezone?: string;
    displayNote?: string;
  };

  @Prop()
  description?: string;

  @Prop()
  websiteUrl?: string;

  @Prop({ default: true })
  isPrimary: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  displayOrder: number;
}

export const EmergencyHotlineSchema =
  SchemaFactory.createForClass(EmergencyHotline);
