import { Injectable } from '@nestjs/common';
import {
  Audience,
  MediaItemDTO,
  PostSnapshotDTO,
  ReactionType,
  ShareSnapshotDTO,
} from '@repo/dtos';
import {
  MediaPreview,
  PostSnapshot,
} from 'src/mongo/schema/post-snapshot.schema';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';

@Injectable()
export class SnapshotMapper {
  static toPostSnapshotDTOs(
    posts: PostSnapshot[],
    record?: Record<string, ReactionType>,
  ): PostSnapshotDTO[] {
    return posts.map((post) =>
      this.toPostSnapshotDTO(post, record?.[post.postId]),
    );
  }

  static toPostSnapshotDTO(
    post: PostSnapshot,
    reactedType?: ReactionType,
  ): PostSnapshotDTO {
    return {
      postId: post.postId,
      userId: post.userId,
      groupId: post.groupId,
      audience: post.audience,
      content: post.content,
      mediaPreviews: this.toMediaItemDTOs(post.mediaPreviews),
      mediaRemaining: post.mediaRemaining,
      mainEmotion: post.mainEmotion,
      createdAt: post.postCreatedAt,
      postStat: post.stats,
      reactedType: reactedType,
    };
  }

  static toShareSnapshotDTOs(
    shares: ShareSnapshot[],
    reactedMap?: Record<string, ReactionType>,
  ): ShareSnapshotDTO[] {
    return shares.map((share) =>
      this.toShareSnapshotDTO(share, reactedMap?.[share.shareId]),
    );
  }

  static toShareSnapshotDTO(
    share: ShareSnapshot,
    reactedType?: ReactionType,
  ): ShareSnapshotDTO {
    return {
      shareId: share.shareId,
      userId: share.userId,
      content: share.content,
      audience: share.audience ? share.audience : Audience.PUBLIC,
      post: {
        postId: share.post.postId,
        userId: share.post.userId,
        groupId: share.post.groupId,
        audience: Audience.PUBLIC,
        content: share.post.content,
        mediaPreviews: this.toMediaItemDTOs(share.post.mediaPreviews),
        mediaRemaining: share.post.mediaRemaining,
        mainEmotion: share.post.mainEmotion,
        createdAt: share.post.createdAt,
      },
      createdAt: share.shareCreatedAt,
      shareStat: share.stats,
      reactedType: reactedType,
    };
  }

  static toMediaItemDTOs(medias: MediaPreview[]): MediaItemDTO[] {
    return medias.map((media) => {
      return this.toMediaItemDTO(media);
    });
  }

  static toMediaItemDTO(media: MediaPreview): MediaItemDTO {
    return {
      type: media.type,
      url: media.url,
    };
  }
}
