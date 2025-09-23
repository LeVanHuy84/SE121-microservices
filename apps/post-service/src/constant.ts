import { ReactionType } from "@repo/dtos";

export const ReactionFieldMap: Record<ReactionType, string> = {
    [ReactionType.LIKE]: "likes",
    [ReactionType.LOVE]: "loves",
    [ReactionType.HAHA]: "hahas",
    [ReactionType.WOW]: "wows",
    [ReactionType.SAD]: "sads",
    [ReactionType.ANGRY]: "angrys",
};