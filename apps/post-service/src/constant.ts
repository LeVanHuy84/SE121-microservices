import { ReactionStatsDto, ReactionType } from "@repo/dtos";

export const ReactionFieldMap: Record<ReactionType, keyof ReactionStatsDto> = {
    [ReactionType.LIKE]: "like",
    [ReactionType.LOVE]: "love",
    [ReactionType.HAHA]: "haha",
    [ReactionType.WOW]: "wow",
    [ReactionType.SAD]: "sad",
    [ReactionType.ANGRY]: "angry",
};