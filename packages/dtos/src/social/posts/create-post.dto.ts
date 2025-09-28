import { IsArray, IsOptional, IsString } from "class-validator";

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
}