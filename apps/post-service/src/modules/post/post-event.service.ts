import { Inject, Injectable } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import {
  MediaItemDTO,
  PostCreatedEvent,
  PostEventMessage,
  PostEventType,
} from '@repo/dtos';
import { MICROSERVICES_CLIENT } from 'src/constant';
import { Post } from 'src/entities/post.entity';

@Injectable()
export class PostEventPublisher {
  constructor(
    @Inject(MICROSERVICES_CLIENT.KAFKA_PRODUCER)
    private readonly clientKafka: ClientKafka
  ) {}

  private async send(topic: string, event: PostEventMessage) {
    this.clientKafka.emit<PostEventMessage>(topic, event);
  }

  async postCreated(post: Post) {
    let mediaPreview: MediaItemDTO[] | undefined = undefined;
    let mediaRemaining: number | undefined = undefined;

    if (Array.isArray(post.media) && post.media.length > 0) {
      mediaPreview = post.media.slice(0, 5);
      mediaRemaining = post.media.length > 5 ? post.media.length - 5 : 0;
    }

    const snapshot: PostCreatedEvent['payload'] = {
      postId: post.id,
      userId: post.userId,
      groupId: post.groupId ?? undefined,
      content: post.content,
      mediaPreview,
      mediaRemaining,
      createdAt: post.createdAt,
    };

    await this.send('post-events', {
      type: PostEventType.POST_CREATED,
      payload: snapshot,
    });
  }

  async postUpdated(postId: string, content: string) {
    await this.send('post-events', {
      type: PostEventType.POST_UPDATED,
      payload: {
        postId,
        content: content,
      },
    });
  }

  async removeFeed(postId: string) {
    await this.send('post-events', {
      type: PostEventType.REMOVE_FEED,
      payload: {
        postId,
      },
    });
  }
}
