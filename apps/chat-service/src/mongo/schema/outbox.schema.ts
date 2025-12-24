import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class OutboxEvent {
  @Prop({ required: true })
  topic: string;

  @Prop({ required: true })
  eventType: string;

  @Prop({ type: Object, required: true })
  payload: Record<string, any>;

  @Prop({ default: false })
  processed: boolean;

  @Prop({ type: Date, default: null })
  processedAt?: Date;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ type: Date, default: null })
  nextRetryAt?: Date;

  @Prop({ type: String, default: null })
  lastError?: string;

  @Prop({ type: String, default: null })
  aggregateId?: string;
}

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);
