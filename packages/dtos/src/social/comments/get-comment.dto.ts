import { Expose } from "class-transformer";
import { MediaDto } from "../common/media.dto";

export class CommentStatsDto {
    @Expose()
    totalReactions: number;

    @Expose()
    replies: number;
}

export class CommentResponseDTO {
    @Expose()
    id: string;

    @Expose()
    userId: string;

    @Expose()
    content: string;

    @Expose()
    media: MediaDto;

    @Expose()
    stats: CommentStatsDto;

    @Expose()
    createdAt: Date;

    @Expose()
    updatedAt: Date;
}