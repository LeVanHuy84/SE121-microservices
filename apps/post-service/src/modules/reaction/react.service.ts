// src/services/reaction.service.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DisReactDto, GetReactionsDto, ReactDto, ReactionResponseDto, ReactionType, StatsDto, TargetType } from "@repo/dtos";
import { plainToInstance } from "class-transformer";
import { Reaction } from "src/entities/reaction.entity";
import { DataSource, EntityManager, Repository } from "typeorm";
import { CommentStat } from "src/entities/comment-stat.entity";
import { PostStat } from "src/entities/post-stat.entity";
import { ReactionFieldMap } from "src/constant";

@Injectable()
export class ReactionService {
    constructor(
        @InjectRepository(Reaction)
        private readonly reactionRepo: Repository<Reaction>,
        private readonly dataSource: DataSource,
    ) { }

    // async react(userId: string, dto: ReactDto) {
    //     const existing = await this.reactionRepo.findOne({
    //         where: { userId, targetId: dto.targetId, targetType: dto.targetType },
    //     });

    //     if (existing) {
    //         // Nếu đổi loại reaction → trừ cái cũ, cộng cái mới
    //         if (existing.reactionType !== dto.reactionType) {
    //             await this.updateStats(dto.targetType, dto.targetId, existing.reactionType, -1);
    //             existing.reactionType = dto.reactionType;
    //             await this.reactionRepo.save(existing);
    //             await this.updateStats(dto.targetType, dto.targetId, dto.reactionType, +1);
    //         }
    //     } else {
    //         // Nếu là reaction mới
    //         await this.reactionRepo.save(this.reactionRepo.create({
    //             userId,
    //             targetId: dto.targetId,
    //             targetType: dto.targetType,
    //             reactionType: dto.reactionType,
    //         }));
    //         await this.updateStats(dto.targetType, dto.targetId, dto.reactionType, +1);
    //     }
    // }

    // async disReact(userId: string, dto: DisReactDto) {
    //     const existing = await this.reactionRepo.findOne({
    //         where: { userId, targetId: dto.targetId, targetType: dto.targetType },
    //     });

    //     if (!existing) return;

    //     await this.reactionRepo.delete(existing.id);
    //     await this.updateStats(dto.targetType, dto.targetId, existing.reactionType, -1);

    //     return { success: true };
    // }

    // private async updateStats(
    //     targetType: TargetType,
    //     targetId: string,
    //     reactionType: ReactionType,
    //     delta: number,
    // ) {
    //     const field = ReactionFieldMap[reactionType];

    //     if (targetType === TargetType.POST) {
    //         await this.postRepo
    //             .createQueryBuilder()
    //             .update(PostStat)
    //             .set({
    //                 [field]: () => `"${field}" + ${delta}`,
    //                 reactions: () => `"reactions" + ${delta}`
    //             })
    //             .where("postId = :postId", { postId: targetId })
    //             .execute();
    //     }

    //     if (targetType === TargetType.COMMENT) {
    //         await this.commentRepo
    //             .createQueryBuilder()
    //             .update(CommentStat)
    //             .set({
    //                 [field]: () => `"${field}" + ${delta}`,
    //                 reactions: () => `"reactions" + ${delta}`,
    //             })
    //             .where("commentId = :commentId", { commentId: targetId })
    //             .execute();
    //     }
    // }

    async getReactions(dto: GetReactionsDto) {
        const [reactions, total] = await this.reactionRepo.findAndCount({
            where: { targetId: dto.targetId, targetType: dto.targetType },
            skip: (dto.page - 1) * dto.limit,
            take: dto.limit,
        });

        const reactionDtos = plainToInstance(ReactionResponseDto, reactions, {
            excludeExtraneousValues: true,
        });

        return { data: reactionDtos, total, page: dto.page, limit: dto.limit };
    }

    async react(userId: string, dto: ReactDto) {
        return this.dataSource.transaction(async (manager) => {
            const reactionRepo = manager.getRepository(Reaction);

            const existing = await reactionRepo.findOne({
                where: { userId, targetId: dto.targetId, targetType: dto.targetType },
            });

            if (existing) {
                // Nếu đổi reaction
                if (existing.reactionType !== dto.reactionType) {
                    await this.updateStatsWithManager(manager, dto.targetType, dto.targetId, existing.reactionType, -1);
                    // Update reaction
                    existing.reactionType = dto.reactionType;
                    await reactionRepo.save(existing);
                    await this.updateStatsWithManager(manager, dto.targetType, dto.targetId, dto.reactionType, +1);
                }
            } else {
                await reactionRepo.save(
                    reactionRepo.create({
                        userId,
                        targetId: dto.targetId,
                        targetType: dto.targetType,
                        reactionType: dto.reactionType,
                    }),
                );
                await this.updateStatsWithManager(manager, dto.targetType, dto.targetId, dto.reactionType, +1);
            }
        });
    }

    async disReact(userId: string, dto: DisReactDto) {
        this.dataSource.transaction(async (manager) => {
            const reactionRepo = manager.getRepository(Reaction);

            // Xoá và lấy lại loại reaction
            const deleted = await reactionRepo
                .createQueryBuilder()
                .delete()
                .from(Reaction)
                .where("userId = :userId", { userId })
                .andWhere("targetId = :targetId", { targetId: dto.targetId })
                .andWhere("targetType = :targetType", { targetType: dto.targetType })
                .returning("reaction_type") // field trong DB
                .execute();

            if (deleted.affected && deleted.raw[0]) {
                const reactionType = deleted.raw[0].reaction_type as ReactionType;
                await this.updateStatsWithManager(manager, dto.targetType, dto.targetId, reactionType, -1);
            }
        });
    }

    private async updateStatsWithManager(
        manager: EntityManager,
        targetType: TargetType,
        targetId: string,
        reactionType: ReactionType,
        delta: number,
    ) {
        const field = ReactionFieldMap[reactionType];

        if (targetType === TargetType.POST) {
            await manager
                .getRepository(PostStat)
                .createQueryBuilder()
                .update()
                .set({
                    [field]: () => `"${field}" + ${delta}`,
                    reactions: () => `"reactions" + ${delta}`,
                })
                .where("postId = :postId", { postId: targetId })
                .execute();
        }

        if (targetType === TargetType.COMMENT) {
            await manager
                .getRepository(CommentStat)
                .createQueryBuilder()
                .update()
                .set({
                    [field]: () => `"${field}" + ${delta}`,
                    reactions: () => `"reactions" + ${delta}`,
                })
                .where("commentId = :commentId", { commentId: targetId })
                .execute();
        }
    }
}
