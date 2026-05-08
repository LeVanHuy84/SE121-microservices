import { IsString } from 'class-validator';

export class CreateAppealRequestDTO {
  @IsString()
  moderationId: string;

  @IsString()
  reason: string;
}
