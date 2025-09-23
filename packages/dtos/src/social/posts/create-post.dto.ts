import { IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { Audience } from "../enums/social.enum";
import { Expose, Type } from "class-transformer";

export class MediaDto {
    @Expose()
    @IsOptional()
    @IsString({ each: true })
    imageUrls?: string[];

    @Expose()
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