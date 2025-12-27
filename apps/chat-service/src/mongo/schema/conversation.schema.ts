import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';



@Schema({ timestamps: true })
export class Conversation {
  @Prop({ type: Boolean, default: false })
  isGroup: boolean;

  @Prop()
  groupId?: string;

  @Prop({
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => Array.isArray(v) && v.length >= 2,
      message: 'Conversation must have at least 2 participants',
    },
  })
  participants: string[];

  @Prop({ type: String })
  groupName?: string;

  @Prop({ type: Object, default: null })
  groupAvatar?: {
    url: string;
    publicId?: string;
  };
  

  @Prop({ type: [String] })
  admins?: string[];

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  lastMessage?: Types.ObjectId;

  @Prop({ type: String, index: true, sparse: true, unique: true })
  directKey?: string;

  @Prop({ type: [String], default: [] })
  hiddenFor: string[];

  @Prop({ type: Map, of: String, default: {} })
  lastSeenMessageId: Map<string, string>;

  @Prop({ type: Number, default: 0 })
  syncVersion: number;
}

export type ConversationDocument = HydratedDocument<Conversation>;

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Index cho query participants nhanh
ConversationSchema.index({ participants: 1, updatedAt: -1 });

// Index cho query 1-1 cực nhanh
ConversationSchema.index({ isGroup: 1, participants: 1 });



/**
 * Normalizer: bỏ trùng & sort participants/admins
 * + build directKey cho 1–1 chat
 */
ConversationSchema.pre<ConversationDocument>('save', function (next) {
  if (this.isModified()) {
    this.syncVersion = Date.now();
  }

  if (this.participants?.length) {
    const normalized = [...new Set(this.participants)].sort();
    this.participants = normalized;

    // 1–1 chat → tạo directKey
    if (!this.isGroup && normalized.length === 2) {
      this.directKey = normalized.join(':'); // ví dụ: "u1:u2"
    } else {
      this.directKey = undefined;
    }
  }

  if (this.admins?.length) {
    this.admins = [...new Set(this.admins)].sort();
  }

  next();
});

ConversationSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as any;
  if (!update) return next();

  update.$set = update.$set ?? {};
  update.$set.syncVersion = Date.now();

  // Nếu dùng $set: { participants: [...] }
  const rawParticipants = update.participants ?? update.$set?.participants;

  if (Array.isArray(rawParticipants)) {
    const normalized = [...new Set(rawParticipants)].sort();

    if (update.$set) {
      update.$set.participants = normalized;
    } else {
      update.participants = normalized;
    }

    // Xử lý directKey cho 1–1 chat
    const isGroup = update.isGroup ?? update.$set?.isGroup ?? undefined; // có thể undefined nếu không update field này

    // Nếu rõ ràng là 1–1
    if (isGroup === false && normalized.length === 2) {
      const key = normalized.join(':');
      if (update.$set) {
        update.$set.directKey = key;
      } else {
        update.directKey = key;
      }
    }
  }

  next();
});
