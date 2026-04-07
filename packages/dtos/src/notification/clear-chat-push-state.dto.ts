import { IsString } from 'class-validator';

export class ClearChatPushStateDto {
  @IsString()
  userId: string;

  @IsString()
  conversationId: string;
}
