// src/notification/schemas/user-preference.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
export type UserPreferenceDocument = UserPreference & Document;

export class DndSettings {
  @Prop({ default: false })
  enabled: boolean;

  @Prop({ default: '22:00' })
  from: string;

  @Prop({ default: '07:00' })
  to: string;
}

export class Settings {
  @Prop({ default: true })
  pushMentions: boolean;

  @Prop({ default: true })
  pushMessages: boolean;

  @Prop({ default: true })
  pushGroupMessages: boolean;

  @Prop({ default: true })
  pushFriendRequests: boolean;

  @Prop({ type: DndSettings, default: () => ({ enabled: false, from: '22:00', to: '07:00' }) })
  doNotDisturb: DndSettings;
}

@Schema()
export class UserPreference {
  @Prop({ required: true, unique: true }) userId: string;
  @Prop({ type: Object, default: { dailyLimit: 100 } }) limits: any; // customize
  
  @Prop({ type: Settings, default: () => ({ pushMentions: true, pushMessages: true, pushFriendRequests: true, doNotDisturb: { enabled: false, from: '22:00', to: '07:00' } }) })
  settings: Settings;
}

export const UserPreferenceSchema =
  SchemaFactory.createForClass(UserPreference);
