import { Injectable } from '@nestjs/common';
import { GroupInfoDTO, ReactionType, ShareSnapshotDTO } from '@repo/dtos';
import { Share } from 'src/entities/share.entity';

@Injectable()
export class ShareShortenMapper {
  static toShareSnapshotDTOs(
    shares: Share[],
    reactionMap?: Map<string, ReactionType | undefined>,
    groupMap?: Map<string, GroupInfoDTO>
  ): ShareSnapshotDTO[] {
    return shares.map((share) => {
      const reactedType = reactionMap?.get(share.id);
      const group = groupMap?.get(share.post.groupId);
      return this.toShareSnapshotDTO(share, reactedType, group);
    });
  }

  static toShareSnapshotDTO(
    share: Share,
    reactedType?: ReactionType,
    group?: GroupInfoDTO
  ): ShareSnapshotDTO {
    return {
      shareId: share.id,
      userId: share.userId,
      audience: share.audience,
      content: share.content,
      post: {
        postId: share.post.id,
        userId: share.post.userId,
        audience: share.post.audience,
        group: group,
        content: share.post.content,
        mediaPreviews: share.post.media?.slice(0, 5),
        mediaRemaining: Math.max(0, (share.post.media?.length ?? 0) - 5),
        createdAt: share.post.createdAt,
      },
      createdAt: share.createdAt,
      reactedType: reactedType,
      shareStat: share.shareStat,
    };
  }

  static toShareSnapshotEvent(
    share: Share,
    reactedType?: ReactionType
  ): ShareSnapshotDTO {
    return {
      shareId: share.id,
      userId: share.userId,
      audience: share.audience,
      content: share.content,
      post: {
        postId: share.post.id,
        userId: share.post.userId,
        groupId: share.post.groupId,
        audience: share.post.audience,
        content: share.post.content,
        mediaPreviews: share.post.media?.slice(0, 5),
        mediaRemaining: Math.max(0, (share.post.media?.length ?? 0) - 5),
        createdAt: share.post.createdAt,
      },
      createdAt: share.createdAt,
      reactedType: reactedType,
    };
  }
}
