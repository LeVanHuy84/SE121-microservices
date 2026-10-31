import { Injectable } from "@nestjs/common";
import {
  Audience,
  BaseUserDTO,
  GroupInfoDTO,
  MediaItemDTO,
  PostSnapshotDTO,
  ReactionType,
  ShareSnapshotDTO,
} from "@repo/dtos";
import { MediaPreview } from "../mongo/schema/post-snapshot.schema";

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
    user?: BaseUserDTO,
    group?: GroupInfoDTO,
  ): PostSnapshotDTO {
    return {
      postId: post.postId,
      userId: post.userId,
      user: user || post.user || undefined,
      group: group || post.group || undefined,
      audience: post.audience,
      content: post.content,
      mediaPreviews: this.toMediaItemDTOs(post.mediaPreviews),
      mediaRemaining: post.mediaRemaining,
      mainEmotion: post.emotionFeature?.label?.toUpperCase() || null,
      createdAt: post.postCreatedAt,
      postStat: post.stats,
      reactedType: reactedType,
    };
  }

  static toShareSnapshotDTOs(
    shares: any[],
    posts: any[],
    reactedMap?: Record<string, ReactionType>,
  ): ShareSnapshotDTO[] {
    const postMap = new Map(posts.map((p) => [p.postId, p]));
    return shares.map((share) => {
      const post = postMap.get(share.postId);
      return this.toShareSnapshotDTO(share, post, reactedMap?.[share.shareId]);
    });
  }

  static toShareSnapshotDTO(
    share: any,
    post: any,
    reactedType?: ReactionType,
    shareUser?: BaseUserDTO,
    postUser?: BaseUserDTO,
    postGroup?: GroupInfoDTO,
  ): ShareSnapshotDTO {
    return {
      shareId: share.shareId,
      userId: share.userId,
      user: shareUser || share.user || undefined,
      content: share.content,
      audience: share.audience ? share.audience : Audience.PUBLIC,
      post: {
        postId: post.postId,
        userId: post.userId,
        user: postUser || post.user || undefined,
        group: postGroup || post.group || undefined,
        audience: post.audience || Audience.PUBLIC,
        content: post.content,
        mediaPreviews: this.toMediaItemDTOs(post.mediaPreviews),
        mediaRemaining: post.mediaRemaining,
        mainEmotion: post.emotionFeature?.label?.toUpperCase() || null,
        createdAt: post.postCreatedAt,
      },
      createdAt: share.shareCreatedAt,
      shareStat: share.stats,
      reactedType: reactedType,
    };
  }

  static toMediaItemDTOs(medias?: MediaPreview[]): MediaItemDTO[] {
    if (!medias || !Array.isArray(medias)) return [];
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
