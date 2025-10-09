import { Inject, Injectable } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import {
  MediaItemDTO,
  SharedPostEvent,
  ShareEventMessage,
  ShareEventType,
} from '@repo/dtos';
import { MICROSERVICES_CLIENT } from 'src/constant';
import { Post } from 'src/entities/post.entity';
import { Share } from 'src/entities/share.entity';

@Injectable()
export class ShareEventPublisher {
  constructor(
    @Inject(MICROSERVICES_CLIENT.KAFKA_PRODUCER)
    private readonly clientKafka: ClientKafka
  ) {}

  private async send(topic: string, event: ShareEventMessage) {
    this.clientKafka.emit<ShareEventMessage>(topic, event);
  }

  async sharedPost(share: Share, post: Post) {
    let mediaPreviews: MediaItemDTO[] | undefined = undefined;
    let mediaRemaining: number | undefined = undefined;

    if (Array.isArray(post.media) && post.media.length > 0) {
      mediaPreviews = post.media.slice(0, 5);
      mediaRemaining = post.media.length > 5 ? post.media.length - 5 : 0;
    }

    const snapshot: SharedPostEvent['payload'] = {
      userId: share.userId,
      shareId: share.id,
      content: share.content,
      post: {
        postId: post.id,
        userId: post.userId,
        groupId: post.groupId ?? undefined,
        content: post.content,
        mediaPreviews,
        mediaRemaining,
        createdAt: post.createdAt,
      },
      createdAt: share.createdAt,
    };

    await this.send('share-events', {
      type: ShareEventType.SHARED_POST,
      payload: snapshot,
    });
  }

  async shareUpdated(shareId: string, content: string) {
    await this.send('share-events', {
      type: ShareEventType.UPDATE_SHARE,
      payload: {
        shareId: shareId,
        content: content,
      },
    });
  }

  async removeShare(shareId: string) {
    await this.send('share-events', {
      type: ShareEventType.REMOVE_SHARE,
      payload: {
        shareId,
      },
    });
  }
}
