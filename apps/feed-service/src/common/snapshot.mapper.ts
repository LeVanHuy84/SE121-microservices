import { Injectable } from '@nestjs/common';
import {
  Audience,
  MediaItemDTO,
  PostSnapshotDTO,
  ReactionType,
  ShareSnapshotDTO,
} from '@repo/dtos';
import { MediaPreview } from 'src/mongo/schema/post-snapshot.schema';

@Injectable()
export class SnapshotMapper {
  static toPostSnapshotDTOs(
    posts: any[],
    record?: Record<string, ReactionType>,
  ): PostSnapshotDTO[] {
    return posts.map((post) =>
      this.toPostSnapshotDTO(post, record?.[post.postId]),
    );
  }

  static toPostSnapshotDTO(
    post: any,
    reactedType?: ReactionType,
  ): PostSnapshotDTO {
    return {
      postId: post.postId,
      userId: post.userId,
      group: post.group || undefined,
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
    shares: any[],
    reactedMap?: Record<string, ReactionType>,
  ): ShareSnapshotDTO[] {
    return shares.map((share) =>
      this.toShareSnapshotDTO(share, reactedMap?.[share.shareId]),
    );
  }

  static toShareSnapshotDTO(
    share: any,
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
        group: share.post.group || undefined,
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
