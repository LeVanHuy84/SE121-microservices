import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { TargetType } from "../enums/social.enum";
import { PaginationDto } from "../../pagination/pagination.dto";

export class GetReactionsDto extends PaginationDto {
    @IsUUID()
    targetId: string;

    @IsOptional()
    @IsEnum(TargetType)
    targetType: TargetType;
}