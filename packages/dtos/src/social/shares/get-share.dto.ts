import { PostResponseDTO } from '../posts/get-post.dto';
import { IsString, IsDate, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ShareResponseDTO {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  content: string;

  @IsDate()
  @Type(() => Date)
  createdAt: Date;

  @ValidateNested()
  @Type(() => PostResponseDTO)
  post: PostResponseDTO;
}
