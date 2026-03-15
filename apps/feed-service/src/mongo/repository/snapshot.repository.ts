import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Audience } from '@repo/dtos';
import { Model } from 'mongoose';
import {
  PostSnapshot,
  PostSnapshotDocument,
} from '../schema/post-snapshot.schema';
import {
  ShareSnapshot,
  ShareSnapshotDocument,
} from '../schema/share-snapshot.schema';

@Injectable()
export class SnapshotRepository {
  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshotDocument>,

    @InjectModel(ShareSnapshot.name)
    private readonly shareModel: Model<ShareSnapshotDocument>,
  ) {}

  async findPostsByIds(ids: string[], mainEmotion?: string) {
    if (!ids?.length) return [];
    const filter = {
      postId: { $in: ids },
      ...(mainEmotion ? { mainEmotion } : {}),
    };
    return this.postModel.find(filter).lean<PostSnapshot[]>().exec();
  }

  async findSharesByIds(ids: string[], mainEmotion?: string) {
    if (!ids?.length) return [];
    const filter = {
      shareId: { $in: ids },
      ...(mainEmotion ? { 'post.mainEmotion': mainEmotion } : {}),
    };
    return this.shareModel.find(filter).lean<ShareSnapshot[]>().exec();
  }

  async findTrendingCandidates(limit = 1000): Promise<PostSnapshot[]> {
    const filter = {
      audience: Audience.PUBLIC,
      $and: [
        {
          $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }],
        },
        {
          $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
        },
      ],
    };

    return this.postModel
      .find(filter)
      .sort({
        'stats.reactions': -1,
        'stats.comments': -1,
        'stats.shares': -1,
        postCreatedAt: -1,
      })
      .limit(limit)
      .lean<PostSnapshot[]>()
      .exec();
  }
}
