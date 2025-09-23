import { Expose, Type } from "class-transformer";
import { MediaDto } from "./create-post.dto";
import { Audience, PostStatus } from "../enums/social.enum";

export class ReactionStatsDto {
    @Expose()
    like: number;

    @Expose()
    love: number;

    @Expose()
    haha: number;

    @Expose()
    wow: number;

    @Expose()
    angry: number;

    @Expose()
    sad: number;
}

export class StatsDto {
    @Expose()
    totalReactions: number;

    @Expose()
    @Type(() => ReactionStatsDto)
    reactions: ReactionStatsDto;

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
