import { Expose, Type } from "class-transformer";
import { MediaDto } from "./create-post.dto";
import { Audience, PostStatus } from "../enums/social.enum";

export class StatsDto {
    @Expose()
    reactions: number;

    @Expose()
    comments: number;

    @Expose()
    shares: number;
}

export class PostResponseDTO {
    @Expose()
    id: string;

    @Expose()
    userId: string;

    @Expose()
    groupId?: string;

    @Expose()
    content: string;

    @Expose()
    @Type(() => MediaDto)
    media: MediaDto;

    @Expose()
    audience: Audience;

    @Expose()
    @Type(() => StatsDto)
    stats: StatsDto;

    @Expose()
    mainEmotion?: string;

    @Expose()
    status: PostStatus;

    @Expose()
    createdAt: Date;

    @Expose()
    updatedAt: Date;
}
