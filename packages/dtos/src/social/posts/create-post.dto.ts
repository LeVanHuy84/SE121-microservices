import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { Audience } from "../enums/social.enum";
import { Type } from "class-transformer";

export class MediaDto {
    @IsOptional()
    @IsString({ each: true })
    imageUrls?: string[];

    @IsOptional()
    @IsString({ each: true })
    videosUrls?: string[];
}

export class CreatePostDto {
    @IsOptional()
    @IsString()
    groupId?: string; // NULL = cá nhân, NOT NULL = group

    @IsString()
    content: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => MediaDto)
    media?: MediaDto;

    @IsOptional()
    @IsEnum(Audience)
    audience?: Audience;
}