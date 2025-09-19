import { IsArray, IsOptional, IsString } from "class-validator";
import { Audience } from "../enums/social.enum";

export class CreatePostDto {
    @IsString()
    userId: string;

    @IsString()
    groupId: string;

    @IsString()
    content: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    imageUrls?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    videoUrls?: string[];

    @IsOptional()
    audience: Audience;
}