// src/notification/schemas/user-preference.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
export type UserPreferenceDocument = UserPreference & Document;

@Schema()
export class UserPreference {
  @Prop({ required: true, unique: true }) userId: string;
  @Prop({ type: [String], default: ['web'] }) allowedChannels: string[];
  @Prop({ type: Object, default: { dailyLimit: 100 } }) limits: any; // customize
}

export const UserPreferenceSchema =
  SchemaFactory.createForClass(UserPreference);
