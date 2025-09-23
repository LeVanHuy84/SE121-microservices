// src/services/reaction.service.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DisReactDto, GetReactionsDto, ReactDto, ReactionResponseDto, ReactionType, StatsDto, TargetType } from "@repo/dtos";
import { plainToInstance } from "class-transformer";
import { Reaction } from "src/entities/reaction.entity";
import { Repository } from "typeorm";
import { Post } from "src/entities/post.entity";
import { Comment } from "src/entities/comment.entity";
import { RpcException } from "@nestjs/microservices";
import { ReactionFieldMap } from "src/constant";

@Injectable()
export class ReactionService {
    constructor(
        @InjectRepository(Reaction)
        private readonly reactionRepo: Repository<Reaction>,
        @InjectRepository(Post)
        private readonly postRepo: Repository<Post>,
        @InjectRepository(Comment)
        private readonly commentRepo: Repository<Comment>,
    ) { }

    async react(userId: string, dto: ReactDto) {
        const existing = await this.reactionRepo.findOne({
            where: { userId, targetId: dto.targetId, targetType: dto.targetType },
        });

        if (existing) {
            // Nếu đổi loại reaction → trừ cái cũ, cộng cái mới
            if (existing.reactionType !== dto.reactionType) {
                await this.updateStats(dto.targetType, dto.targetId, existing.reactionType, -1);
                existing.reactionType = dto.reactionType;
                await this.reactionRepo.save(existing);
                await this.updateStats(dto.targetType, dto.targetId, dto.reactionType, +1);
            }
            return true;
        }

        // Nếu là reaction mới
        await this.reactionRepo.save(this.reactionRepo.create({
            userId,
            targetId: dto.targetId,
            targetType: dto.targetType,
            reactionType: dto.reactionType,
        }));
        await this.updateStats(dto.targetType, dto.targetId, dto.reactionType, +1);

        return true;
    }

    async disReact(userId: string, dto: DisReactDto) {
        const existing = await this.reactionRepo.findOne({
            where: { userId, targetId: dto.targetId, targetType: dto.targetType },
        });

        if (!existing) return { success: false, message: 'No reaction to remove' };

        await this.reactionRepo.delete(existing.id);
        await this.updateStats(dto.targetType, dto.targetId, existing.reactionType, -1);

        return { success: true };
    }

    private async updateStats(
        targetType: TargetType,
        targetId: string,
        reactionType: ReactionType,
        delta: number,
    ) {
        const field = ReactionFieldMap[reactionType];

        if (targetType === TargetType.POST) {
            const post = await this.postRepo.findOneBy({ id: targetId });
            if (!post)
                throw new RpcException('Post not found');

            post.stats.reactions[field] += delta;
            post.stats.totalReactions += delta;
            await this.postRepo.save(post);
        }

        if (targetType === TargetType.COMMENT) {
            const comment = await this.commentRepo.findOneBy({ id: targetId });
            if (!comment) return;

            comment.stats.reactions[field] += delta;
            comment.stats.totalReactions += delta;
            await this.commentRepo.save(comment);
        }
    }

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
}
