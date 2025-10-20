import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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
}
