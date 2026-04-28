import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { FeedEventType, InferSharePayload, ShareEventType } from '@repo/dtos';
import {
  ShareSnapshot,
  ShareSnapshotDocument,
} from 'src/mongo/schema/share-snapshot.schema';
import { DistributionService } from './distribution.service';

@Injectable()
export class IngestionShareService {
  constructor(
    @InjectModel(ShareSnapshot.name)
    private shareModel: Model<ShareSnapshotDocument>,
    private readonly distributionService: DistributionService,
  ) {}

  async handleCreated(
    payload: InferSharePayload<ShareEventType.CREATED>,
    session?: ClientSession,
  ) {
    if (!payload.shareId) return;
    const exists = await this.shareModel.findOne(
      { shareId: payload.shareId },
      null,
      { session },
    );

    if (exists) return;

    const [shareSnapshot] = await this.shareModel.insertMany(
      [
        {
          ...payload,
          shareCreatedAt: payload.createdAt,
        },
      ],
      { session },
    );

    await this.distributionService.distributeCreated(
      FeedEventType.SHARE,
      shareSnapshot.id,
      shareSnapshot.shareId,
      shareSnapshot.postId,
      shareSnapshot.userId,
      undefined,
      session,
    );
  }

  async handleUpdated(
    payload: InferSharePayload<ShareEventType.UPDATED>,
    session?: ClientSession,
  ) {
    if (!payload.shareId) return;
    await this.shareModel.updateOne(
      { shareId: payload.shareId },
      { $set: { content: payload.content, audience: payload.audience } },
      { session },
    );
  }

  async handleRemoved(
    payload: InferSharePayload<ShareEventType.REMOVED>,
    session?: ClientSession,
  ) {
    if (!payload.shareId) return;
    const snapshot = await this.shareModel.findOneAndDelete(
      {
        shareId: payload.shareId,
      },
      { session },
    );

    if (snapshot) {
      await this.distributionService.distributeRemoved(snapshot.id, session);
    }
  }
}
