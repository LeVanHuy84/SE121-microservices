import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SendChatPushDto {
  @IsString()
  userId: string;

  @IsString()
  conversationId: string;

  @IsBoolean()
  isGroup: boolean;

  @IsString()
  senderId: string;

  @IsString()
  senderName: string;

  @IsOptional()
  @IsString()
  senderAvatar?: string;

  @IsOptional()
  @IsString()
  conversationName?: string;

  @IsOptional()
  @IsString()
  preview?: string;

  @IsString()
  messageId: string;
}
