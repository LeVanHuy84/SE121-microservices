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
    const result: PostSnapshotDTO[] = new Array(posts.length);
    for (let i = 0; i < posts.length; i++) {
      result[i] = this.toPostSnapshotDTO(posts[i]);
    }
    return result;
  }

  static toPostSnapshotDTO(post: PostSnapshot): PostSnapshotDTO {
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
    };
  }

  static toShareSnapshotDTOs(shares: ShareSnapshot[]): ShareSnapshotDTO[] {
    const result: ShareSnapshotDTO[] = new Array(shares.length);
    for (let i = 0; i < shares.length; i++) {
      result[i] = this.toShareSnapshotDTO(shares[i]);
    }
    return result;
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
        mainEmotion: share.post.mainEmotion,
        createdAt: share.post.createdAt,
      },
      createdAt: share.shareCreatedAt,
      shareStat: share.stats,
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
