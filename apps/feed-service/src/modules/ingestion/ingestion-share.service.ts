import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FeedEventType, InferSharePayload, ShareEventType } from '@repo/dtos';
import { DistributionService } from '../distribution/distribution.service';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';

@Injectable()
export class IngestionShareService {
  constructor(
    @InjectModel(ShareSnapshot.name) private shareModel: Model<ShareSnapshot>,
    private readonly distributionService: DistributionService,
  ) {}

  async handleCreated(payload: InferSharePayload<ShareEventType.CREATED>) {
    if (!payload.shareId) return;
    const exists = await this.shareModel.findOne({
      where: { id: payload.shareId },
    });
    if (exists) return;

    const shareSnapshot = await this.shareModel.create({
      ...payload,
      shareCreatedAt: payload.createdAt,
    });

    this.distributionService.distributeCreated(
      FeedEventType.SHARE,
      shareSnapshot.id,
      shareSnapshot.userId,
    );
  }

  async handleUpdated(payload: InferSharePayload<ShareEventType.UPDATED>) {
    if (!payload.shareId) return;
    await this.shareModel.updateOne(
      { shareId: payload.shareId },
      { $set: { content: payload.content } },
    );
  }

  async handleRemoved(payload: InferSharePayload<ShareEventType.REMOVED>) {
    if (!payload.shareId) return;
    const snapshot = await this.shareModel.findOneAndDelete({
      shareId: payload.shareId,
    });

    if (snapshot) {
      await this.distributionService.distributeRemoved(snapshot.id);
    }
  }
}
