import { Inject, Injectable } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { PostCreatedEvent, PostEventMessage, PostEventType } from '@repo/dtos';
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
    const snapshot: PostCreatedEvent['payload'] = {
      postId: post.id,
      userId: post.userId,
      groupId: post.groupId ?? undefined,
      contentSnippet: post.content?.substring(0, 100),
      mediaPreview: post.media
        ? {
            imageUrls: post.media.imageUrls?.slice(0, 5),
            videoUrls: post.media.videoUrls?.slice(0, 1),
          }
        : undefined,
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
        contentSnippet: content.substring(0, 100),
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
