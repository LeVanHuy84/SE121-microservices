import { PostResponseDTO } from '../posts/get-post.dto';
import { IsString, IsDate, IsNotEmpty, ValidateNested } from 'class-validator';
import { Expose, Type } from 'class-transformer';
import { BaseUserDTO } from '../../user/get-user.dto';

export class ShareResponseDTO {
  @Expose()
  id: string;

  @Expose()
  @Type(() => BaseUserDTO)
  user: BaseUserDTO | null;

  @Expose()
  content: string;

  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @Expose()
  @Type(() => PostResponseDTO)
  post: PostResponseDTO;
}
