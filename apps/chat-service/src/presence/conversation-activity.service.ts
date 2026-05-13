import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class ConversationActivityService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async isViewingConversation(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    if (!userId || !conversationId) {
      return false;
    }

    const setKey = this.getUserConversationKey(userId, conversationId);
    const socketIds = await this.redis.smembers(setKey);
    if (!socketIds.length) {
      return false;
    }

    const pipeline = this.redis.pipeline();
    socketIds.forEach((socketId) =>
      pipeline.get(this.getConnectionKey(userId, socketId)),
    );
    const results = await pipeline.exec();

    const staleSocketIds: string[] = [];
    let hasActiveSocket = false;

    results?.forEach(([error, value], index) => {
      if (error || value !== conversationId) {
        staleSocketIds.push(socketIds[index]);
        return;
      }

      hasActiveSocket = true;
    });

    if (staleSocketIds.length) {
      await this.redis.srem(setKey, ...staleSocketIds);
    }

    return hasActiveSocket;
  }

  async filterReceiversOutsideConversation(
    userIds: string[],
    conversationId: string,
  ): Promise<string[]> {
    const checks = await Promise.all(
      userIds.map((userId) =>
        this.isViewingConversation(userId, conversationId),
      ),
    );

    return userIds.filter((_, index) => !checks[index]);
  }

  private getUserConversationKey(userId: string, conversationId: string) {
    return `chat:activeConv:user:${userId}:${conversationId}`;
  }

  private getConnectionKey(userId: string, socketId: string) {
    return `chat:activeConv:conn:${userId}:${socketId}`;
  }
}
