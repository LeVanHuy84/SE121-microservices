import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDTO } from '../../pagination/pagination.dto';
import { RootType } from '../enums/social.enum';

export class GetCommentQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsUUID()
  rootId?: string;

  @IsOptional()
  @IsEnum(RootType)
  rootType?: RootType;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
