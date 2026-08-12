import { AdminAppealQueueItemDTO, TargetType } from '@repo/dtos';
import { Comment } from 'src/entities/comment.entity';
import { Post } from 'src/entities/post.entity';
import { Share } from 'src/entities/share.entity';

type TargetMaps = {
  postMap: Map<string, Post>;
  commentMap: Map<string, Comment>;
  shareMap: Map<string, Share>;
};

export class ModerationAppealMapper {
  static buildTargetPreview(
    targetType: TargetType,
    targetId: string,
    maps: TargetMaps,
  ): AdminAppealQueueItemDTO['targetPreview'] {
    const { postMap, commentMap, shareMap } = maps;

    // POST
    if (targetType === TargetType.POST) {
      const post = postMap.get(targetId);

      return {
        content: post?.content?.slice(0, 100),
        imageUrl: post?.media?.[0],
      };
    }

    // COMMENT
    if (targetType === TargetType.COMMENT) {
      const comment = commentMap.get(targetId);

      return {
        content: comment?.content?.slice(0, 100),
        imageUrl: comment?.media,
      };
    }

    // SHARE
    if (targetType === TargetType.SHARE) {
      const share = shareMap.get(targetId);

      return {
        content: share?.content?.slice(0, 100),
      };
    }

    return undefined;
  }

  static toAdminAppealQueueItemDTO(
    row: any,
    targetPreview: AdminAppealQueueItemDTO['targetPreview'],
    appealCount: number,
  ): AdminAppealQueueItemDTO {
    return {
      id: row.appeal_id,

      moderationId: row.moderation_id,

      userId: row.user_id,

      reason: row.reason,

      status: row.status,

      reviewedBy: row.reviewed_by,

      reviewNote: row.review_note,

      reviewedAt: row.reviewed_at,

      createdAt: row.created_at,

      moderation: {
        targetType: row.target_type,

        maxSeverity: row.max_severity,

        confidence: Number(row.confidence),

        displayMessage: row.display_message,

        finalDecision: row.final_decision,
      },

      targetPreview,

      appealCount,
    };
  }
}
