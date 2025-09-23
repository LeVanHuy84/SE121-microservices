import { IsEnum, IsUUID } from "class-validator";
import { TargetType } from "../enums/social.enum";

export class DisReactDto {
    @IsUUID()
    targetId: string;

    @IsEnum(TargetType)
    targetType: TargetType;
}