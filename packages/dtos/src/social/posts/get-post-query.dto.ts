import { IsEnum, IsOptional } from "class-validator";
import { PaginationDto } from "../../pagination/pagination.dto";
import { Feeling, PostStatus } from "../enums/social.enum";

export class GetPostQueryDto extends PaginationDto {
    @IsOptional()
    @IsEnum(PostStatus)
    status?: PostStatus;

    @IsOptional()
    @IsEnum(Feeling)
    feeling?: Feeling;
}
