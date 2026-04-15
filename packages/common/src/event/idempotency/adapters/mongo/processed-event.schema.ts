import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MongoProcessedEventDocument = HydratedDocument<MongoProcessedEvent>;

@Schema({
  collection: 'processed_events',
  timestamps: false, // bạn tự control updatedAt
})
export class MongoProcessedEvent {
  @Prop({ required: true })
  _id: string; // eventId

  @Prop({
    required: true,
    enum: ['PROCESSING', 'DONE', 'FAILED'],
    default: 'PROCESSING',
    index: true,
  })
  status: 'PROCESSING' | 'DONE' | 'FAILED';

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const MongoProcessedEventSchema =
  SchemaFactory.createForClass(MongoProcessedEvent);
