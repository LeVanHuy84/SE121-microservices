import { IsEnum, IsUUID } from "class-validator";
import { ReactionType, TargetType } from "../enums/social.enum";

export class ReactDto {
    @IsUUID()
    targetId: string;

    @IsEnum(TargetType)
    targetType: TargetType;

    @IsEnum(ReactionType)
    reactionType: ReactionType;
}