import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { FeedItem } from 'src/mongo/schema/feed-item.schema';
import { MICROSERVICE_CLIENT } from 'src/constants';
import { calculateRankingScore } from 'src/utils/utils';

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);

  constructor(
    @InjectModel(FeedItem.name) private feedItemModel: Model<FeedItem>,
    @Inject(MICROSERVICE_CLIENT.SOCIAL_SERVICE)
    private readonly socialClient: ClientProxy,
  ) {}

  /**
   * Phân phối post snapshot tới bạn bè của actor
   */
  async distributePost(snapshotId: string, actorId: string) {
    this.logger.log(`Distributing snapshot ${snapshotId} from ${actorId}`);

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
      snapshotId: new Types.ObjectId(snapshotId), // tham chiếu tới post_snapshot
      eventType: 'post',
      timestamp: now,
      rankingScore,
    }));

    // 3. Bulk insert (MongoDB tự scale tốt hơn so với update array)
    await this.feedItemModel.insertMany(feedItems);

    this.logger.log(
      `✅ Distributed snapshot ${snapshotId} to ${friendIds.length} friends`,
    );
  }

  /**
   * Xoá snapshot và feedItems liên quan (khi xoá post hoặc thay đổi quyền riêng tư)
   */
  async removePost(snapshotId: string) {
    this.logger.log(`Removing snapshot ${snapshotId} and related feed items`);

    await this.feedItemModel.deleteMany({
      snapshotId: new Types.ObjectId(snapshotId),
    });

    this.logger.log(`✅ Removed snapshot ${snapshotId} and its feed items`);
  }
}
