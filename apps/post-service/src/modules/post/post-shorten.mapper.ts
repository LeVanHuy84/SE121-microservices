import { Injectable } from '@nestjs/common';
import { GroupInfoDTO, PostSnapshotDTO, ReactionType } from '@repo/dtos';
import { Post } from 'src/entities/post.entity';

@Injectable()
export class PostShortenMapper {
  static toPostSnapshotDTOs(
    posts: Post[],
    reactionMap: Map<string, ReactionType | undefined>
  ): PostSnapshotDTO[] {
    return posts.map((post) => {
      const reactedType = reactionMap.get(post.id);
      return this.toPostSnapshotDTO(post, reactedType);
    });
  }

  static toPostSnapshotDTO(
    post: Post,
    reactedType?: ReactionType,
    group?: GroupInfoDTO
  ): PostSnapshotDTO {
    return {
      postId: post.id,
      userId: post.userId,
      group: group || undefined,
      content: post.content,
      audience: post.audience,
      mediaPreviews: post.media?.slice(0, 5),
      mediaRemaining: Math.max(0, (post.media?.length ?? 0) - 5),
      mainEmotion: post.mainEmotion,
      createdAt: post.createdAt,
      reactedType: reactedType,
      postStat: post.postStat,
    };
  }
}
