import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { FeedItem, FeedItemDocument } from 'src/mongo/schema/feed-item.schema';
import { MICROSERVICE_CLIENT } from 'src/constants';
import { calculateRankingScore } from 'src/utils/utils';
import { FeedEventType } from '@repo/dtos';

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);

  constructor(
    @InjectModel(FeedItem.name) private feedItemModel: Model<FeedItemDocument>,
    @Inject(MICROSERVICE_CLIENT.SOCIAL_SERVICE)
    private readonly socialClient: ClientProxy,
  ) {}

  /**
   * Phân phối snapshot tới bạn bè của actor
   */
  async distributeCreated(
    type: FeedEventType,
    snapshotId: string,
    refId: string,
    actorId: string,
  ) {
    this.logger.log(`Distributing snapshot ${snapshotId} from ${actorId}`);

    try {
      // 1. Lấy danh sách bạn bè từ social-service
      const friendIds: string[] = await firstValueFrom(
        this.socialClient.send(
          { cmd: 'get_friend_ids' },
          { userId: actorId, limit: 200 },
        ),
      );

      if (!friendIds?.length) {
        this.logger.warn(`No friends found for ${actorId}`);
        return;
      }

      // 2. Chuẩn bị các FeedItem cho từng bạn bè
      const now = new Date();
      const rankingScore = calculateRankingScore('post');

      const feedItems = friendIds.map((fid) => ({
        userId: fid,
        snapshotId: new Types.ObjectId(snapshotId),
        eventType: type,
        refId: refId,
        timestamp: now,
        rankingScore,
      }));

      // 3. Bulk insert
      await this.feedItemModel.insertMany(feedItems);

      this.logger.log(
        `✅ Distributed snapshot ${snapshotId} to ${friendIds.length} friends`,
      );
    } catch (error) {
      throw new RpcException(error);
    }
  }

  /**
   * Xoá snapshot và feedItems liên quan
   */
  async distributeRemoved(snapshotId: string) {
    this.logger.log(`Removing snapshot ${snapshotId} and related feed items`);

    try {
      await this.feedItemModel.deleteMany({
        snapshotId: new Types.ObjectId(snapshotId),
      });

      this.logger.log(`✅ Removed snapshot ${snapshotId} and its feed items`);
    } catch (error) {
      throw new RpcException(error);
    }
  }
}
