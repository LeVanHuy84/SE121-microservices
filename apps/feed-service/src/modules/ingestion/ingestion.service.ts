import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import {
  PostCreatedEvent,
  PostUpdatedEvent,
  PostDeletedEvent,
} from '@repo/dtos';
import { DistributionService } from '../distribution/distribution.service';

@Injectable()
export class IngestionService {
  constructor(
    @InjectModel(PostSnapshot.name) private snapshotModel: Model<PostSnapshot>,
    private readonly distributionService: DistributionService,
  ) {}

  async handleCreated(payload: PostCreatedEvent['payload']) {
    const entity = await this.snapshotModel.create({
      ...payload,
    });
    this.distributionService.distributePost(entity.id, entity.userId);
  }

  async handleUpdated(payload: PostUpdatedEvent['payload']) {
    await this.snapshotModel.updateOne(
      { postId: payload.postId },
      { $set: { contentSnippet: payload.contentSnippet } },
    );
  }

  async handleDeleted(payload: PostDeletedEvent['payload']) {
    const snapshot = await this.snapshotModel.findOneAndDelete({
      postId: payload.postId,
    });

    if (snapshot) {
      await this.distributionService.removePost(snapshot.id);
    }
  }
}
