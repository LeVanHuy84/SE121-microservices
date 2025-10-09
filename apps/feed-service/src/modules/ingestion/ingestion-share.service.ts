import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FeedEventType,
  ShareDeletedEvent,
  SharedPostEvent,
  ShareUpdatedEvent,
} from '@repo/dtos';
import { DistributionService } from '../distribution/distribution.service';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';

@Injectable()
export class IngestionShareService {
  constructor(
    @InjectModel(ShareSnapshot.name) private shareModel: Model<ShareSnapshot>,
    private readonly distributionService: DistributionService,
  ) {}

  async handleShared(payload: SharedPostEvent['payload']) {
    const shareSnapshot = await this.shareModel.create({
      ...payload,
    });

    this.distributionService.distributeCreated(
      FeedEventType.SHARE,
      shareSnapshot.id,
      shareSnapshot.userId,
    );
  }

  async handleUpdated(payload: ShareUpdatedEvent['payload']) {
    await this.shareModel.updateOne(
      { shareId: payload.shareId },
      { $set: { content: payload.content } },
    );
  }

  async handleDeleted(payload: ShareDeletedEvent['payload']) {
    const snapshot = await this.shareModel.findOneAndDelete({
      shareId: payload.shareId,
    });

    if (snapshot) {
      await this.distributionService.distributeRemoved(snapshot.id);
    }
  }
}
