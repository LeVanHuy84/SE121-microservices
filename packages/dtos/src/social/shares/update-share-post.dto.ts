import { IsString, Length } from 'class-validator';

export class UpdateShareDTO {
  @IsString()
  @Length(1, 2000)
  content: string;
}
