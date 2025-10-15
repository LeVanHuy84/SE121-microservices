import { IsString } from 'class-validator';

export class MarkSeenDTO {
  @IsString()
  conversationId: string;

  @IsString()
  userId: string;
}
