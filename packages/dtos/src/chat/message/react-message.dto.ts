import { IsString } from 'class-validator';

export class ReactMessageDTO {
  @IsString()
  messageId: string;

  @IsString()
  userId: string;

  @IsString()
  emoji: string;
}
