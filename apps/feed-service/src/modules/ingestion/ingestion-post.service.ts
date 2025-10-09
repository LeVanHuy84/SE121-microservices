import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import {
  PostCreatedEvent,
  PostUpdatedEvent,
  PostDeletedEvent,
  FeedEventType,
} from '@repo/dtos';
import { DistributionService } from '../distribution/distribution.service';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';

@Injectable()
export class IngestionPostService {
  constructor(
    @InjectModel(PostSnapshot.name) private postModel: Model<PostSnapshot>,
    @InjectModel(ShareSnapshot.name) private shareModel: Model<ShareSnapshot>,
    private readonly distributionService: DistributionService,
  ) {}

  async handleCreated(payload: PostCreatedEvent['payload']) {
    console.log('IngestionService handleCreated', payload);
    const entity = await this.postModel.create({
      ...payload,
    });
    this.distributionService.distributeCreated(
      FeedEventType.POST,
      entity.id,
      entity.userId,
    );
  }

  async handleUpdated(payload: PostUpdatedEvent['payload']) {
    await this.postModel.updateOne(
      { postId: payload.postId },
      { $set: { content: payload.content } },
    );
  }

  async handleDeleted(payload: PostDeletedEvent['payload']) {
    const snapshot = await this.postModel.findOneAndDelete({
      postId: payload.postId,
    });

    await this.shareModel.deleteMany({ postId: payload.postId });

    if (snapshot) {
      await this.distributionService.distributeRemoved(snapshot.id);
    }
  }
}
