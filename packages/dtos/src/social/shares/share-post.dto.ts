import { IsString, IsUUID, Length } from 'class-validator';

export class CreateShareDTO {
  @IsUUID()
  postId: string;

  @IsString()
  @Length(1, 2000)
  content: string;
}
