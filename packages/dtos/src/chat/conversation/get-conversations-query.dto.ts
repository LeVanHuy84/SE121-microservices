import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';

export class GetConversationsQueryDTO extends CursorPaginationDTO {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  query?: string;
}
