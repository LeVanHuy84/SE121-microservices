import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { lastValueFrom, timeout } from 'rxjs';
import {
  FeedItem,
  FeedItemDocument,
} from '../../mongo/schema/feed-item.schema';
import { FeedEventType } from '@repo/dtos';
import { MICROSERVICES_CLIENT } from 'src/constant';

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);

  constructor(
    @InjectModel(FeedItem.name) private feedItemModel: Model<FeedItemDocument>,
    @Inject(MICROSERVICES_CLIENT.USER_SOCIAL_SERVICE)
    private readonly userSocialClient: ClientProxy,
  ) {}

  /**
   * Phân phối snapshot tới bạn bè của actor
   */
  async distributeCreated(
    type: FeedEventType,
    snapshotId: string,
    refId: string,
    postId: string,
    actorId: string,
    groupId?: string,
    session?: ClientSession,
  ) {
    this.logger.log(`Distributing snapshot ${snapshotId} from ${actorId}`);

    try {
      let receiver: string[] = [];

      if (groupId) {
        receiver = await lastValueFrom(
          this.userSocialClient
            .send('get_group_member_user_ids', { groupId })
            .pipe(timeout(5000)),
        );
      } else {
        receiver = await lastValueFrom(
          this.userSocialClient
            .send({ cmd: 'get_friend_ids' }, { userId: actorId, limit: 200 })
            .pipe(timeout(5000)),
        );
      }

      if (!receiver?.length) {
        this.logger.warn(`No friends found for ${actorId}`);
        return;
      }

      // 2. Chuẩn bị các FeedItem cho từng bạn bè
      const now = new Date();

      const feedItems = receiver.map((fid) => ({
        userId: fid,
        snapshotId: new Types.ObjectId(snapshotId),
        eventType: type,
        refId: refId,
        postId: postId,
        timestamp: now,
      }));

      // 3. Bulk insert
      await this.feedItemModel.insertMany(feedItems, { session });

      this.logger.log(
        `✅ Distributed snapshot ${snapshotId} to ${receiver.length} friends`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new RpcException(error.message);
      }

      throw new RpcException('Unknown error');
    }
  }

  /**
   * Xoá snapshot và feedItems liên quan
   */
  async distributeRemoved(snapshotId: string, session?: ClientSession) {
    this.logger.log(`Removing snapshot ${snapshotId} and related feed items`);

    try {
      await this.feedItemModel.deleteMany(
        {
          snapshotId: new Types.ObjectId(snapshotId),
        },
        {
          session,
        },
      );

      this.logger.log(`✅ Removed snapshot ${snapshotId} and its feed items`);
    } catch (error) {
      if (error instanceof Error) {
        throw new RpcException(error.message);
      }

      throw new RpcException('Unknown error');
    }
  }
}
