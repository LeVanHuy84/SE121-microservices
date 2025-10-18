import { IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { PaginationDTO } from '../../pagination/pagination.dto';
import { RootType } from '../enums/social.enum';

export class GetCommentQueryDTO extends PaginationDTO {
  @ValidateIf((o) => !o.parentId) // chỉ cần rootId khi không có parentId
  @IsUUID()
  rootId?: string;

  @ValidateIf((o) => !o.parentId) // rootType bắt buộc khi query root
  @IsEnum(RootType)
  rootType?: RootType;

  @ValidateIf((o) => !o.rootId && !o.rootType) // parentId chỉ khi không có root
  @IsUUID()
  parentId?: string;
}
