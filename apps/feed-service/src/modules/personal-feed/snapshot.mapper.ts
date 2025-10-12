import { Injectable } from '@nestjs/common';
import { MediaItemDTO, PostSnapshotDTO, ShareSnapshotDTO } from '@repo/dtos';
import {
  MediaPreview,
  PostSnapshot,
} from 'src/mongo/schema/post-snapshot.schema';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';

@Injectable()
export class SnapshotMapper {
  static toPostSnapshotDTOs(posts: PostSnapshot[]): PostSnapshotDTO[] {
    return posts.map((post) => {
      return this.toPostSnapshotDTO(post);
    });
  }

  static toPostSnapshotDTO(post: PostSnapshot): PostSnapshotDTO {
    return {
      postId: post.postId,
      userId: post.userId,
      groupId: post.groupId,
      content: post.content,
      mediaPreviews: this.toMediaItemDTOs(post.mediaPreviews),
      mediaRemaining: post.mediaRemaining,
      createdAt: post.postCreatedAt,
    };
  }

  static toShareSnapshotDTOs(shares: ShareSnapshot[]): ShareSnapshotDTO[] {
    return shares.map((share) => {
      return this.toShareSnapshotDTO(share);
    });
  }

  static toShareSnapshotDTO(share: ShareSnapshot): ShareSnapshotDTO {
    return {
      shareId: share.shareId,
      userId: share.userId,
      content: share.content,
      post: {
        postId: share.post.postId,
        userId: share.post.userId,
        groupId: share.post.groupId,
        content: share.post.content,
        mediaPreviews: this.toMediaItemDTOs(share.post.mediaPreviews),
        mediaRemaining: share.post.mediaRemaining,
        createdAt: share.post.createdAt,
      },
      createdAt: share.shareCreatedAt,
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
