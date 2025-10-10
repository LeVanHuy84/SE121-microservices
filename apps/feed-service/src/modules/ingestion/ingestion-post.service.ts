import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';
import { DistributionService } from '../distribution/distribution.service';
import { FeedEventType, InferPostPayload, PostEventType } from '@repo/dtos';

@Injectable()
export class IngestionPostService {
  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshot>,
    @InjectModel(ShareSnapshot.name)
    private readonly shareModel: Model<ShareSnapshot>,
    private readonly distributionService: DistributionService,
  ) {}

  // ------------------------------------------------
  // 🧩 HANDLE CREATED
  // ------------------------------------------------
  async handleCreated(payload: InferPostPayload<PostEventType.CREATED>) {
    if (!payload.postId) return;
    const exists = await this.postModel.findOne({
      where: { id: payload.postId },
    });
    if (exists) return;

    console.log('IngestionPostService handleCreated', payload);

    const entity = await this.postModel.create({
      ...payload,
      postCreatedAt: payload.createdAt,
    });

    await this.distributionService.distributeCreated(
      FeedEventType.POST,
      entity.postId,
      entity.userId,
    );
  }

  // ------------------------------------------------
  // 🧩 HANDLE UPDATED
  // ------------------------------------------------
  async handleUpdated(payload: InferPostPayload<PostEventType.UPDATED>) {
    if (!payload.postId) return;

    await this.postModel.updateOne(
      { postId: payload.postId },
      { $set: { content: payload.content } },
    );
  }

  // ------------------------------------------------
  // 🧩 HANDLE REMOVED
  // ------------------------------------------------
  async handleRemoved(payload: InferPostPayload<PostEventType.REMOVED>) {
    if (!('postId' in payload)) return;

    const snapshot = await this.postModel.findOneAndDelete({
      postId: payload.postId,
    });

    await this.shareModel.deleteMany({ postId: payload.postId });

    if (snapshot) {
      await this.distributionService.distributeRemoved(snapshot.postId);
    }
  }
}
