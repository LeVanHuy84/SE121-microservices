import { IsNotEmpty, IsString, Length } from 'class-validator';

export class UpdateCommentDTO {
  @IsString()
  @IsNotEmpty()
  @Length(1, 1000)
  content!: string;
}
