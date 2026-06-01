import { IsString } from 'class-validator';

export class GetUserPreferenceDto {
  @IsString()
  userId: string;
}
