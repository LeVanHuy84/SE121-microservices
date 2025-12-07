import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class Attachment {
  @Prop({ required: true })
  url: string; // link file

  @Prop()
  fileName?: string;

  @Prop()
  mimeType?: string;

  @Prop()
  size?: number; // bytes

  @Prop()
  thumbnailUrl?: string; // cho video hoặc ảnh
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);