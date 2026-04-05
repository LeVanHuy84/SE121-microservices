// // ==============================
// // TYPES
// // ==============================
// export type RankedItem = {
//   itemId: string;
//   score: number;
// };

// export type FeedSession = {
//   heap: RankedItem[]; // top K
//   offset: number; // đã load đến đâu
//   hasMore: boolean;
// };

// export class MinHeap {
//   private data: RankedItem[] = [];

//   constructor(private capacity: number) {}

//   push(item: RankedItem) {
//     if (this.data.length < this.capacity) {
//       this.data.push(item);
//       this.bubbleUp();
//     } else if (item.score > this.data[0].score) {
//       this.data[0] = item;
//       this.bubbleDown();
//     }
//   }

//   toSortedDesc() {
//     return [...this.data].sort((a, b) => {
//       if (b.score !== a.score) return b.score - a.score;
//       return b.itemId.localeCompare(a.itemId);
//     });
//   }

//   private bubbleUp() {
//     let i = this.data.length - 1;
//     while (i > 0) {
//       const p = Math.floor((i - 1) / 2);
//       if (this.data[p].score <= this.data[i].score) break;
//       [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
//       i = p;
//     }
//   }

//   private bubbleDown() {
//     let i = 0;
//     while (true) {
//       let left = 2 * i + 1;
//       let right = 2 * i + 2;
//       let smallest = i;

//       if (
//         left < this.data.length &&
//         this.data[left].score < this.data[smallest].score
//       ) {
//         smallest = left;
//       }

//       if (
//         right < this.data.length &&
//         this.data[right].score < this.data[smallest].score
//       ) {
//         smallest = right;
//       }

//       if (smallest === i) break;

//       [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
//       i = smallest;
//     }
//   }
// }

// import { Inject, Injectable, Logger } from '@nestjs/common';
// import { InjectModel } from '@nestjs/mongoose';
// import { Model } from 'mongoose';
// import {
//   CursorPageResponse,
//   FeedEventType,
//   FeedItemDTO,
//   PersonalFeedQuery,
//   ReactionType,
//   TargetType,
// } from '@repo/dtos';
// import { FeedItem, FeedItemDocument } from 'src/mongo/schema/feed-item.schema';
// import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
// import { SnapshotMapper } from 'src/common/snapshot.mapper';
// import { ClientProxy } from '@nestjs/microservices';
// import { firstValueFrom } from 'rxjs';
// import { InjectRedis } from '@nestjs-modules/ioredis';
// import Redis from 'ioredis';

// import { PersonalFeedHelper } from '../helpers/personal-feed.helper';
// import { AffinityService } from 'src/modules/affinity/affinity.service';
// import { EmotionFeatureService } from 'src/modules/ranking/services/emotion-feature.service';
// import { FeedSession, MinHeap } from '../helpers/min-heap.helper';

// @Injectable()
// export class PersonalFeedService {
//   private readonly logger = new Logger(PersonalFeedService.name);

//   private readonly SESSION_TTL = 30;
//   private readonly WINDOW_SIZE = 100;
//   private readonly TOP_K = 100;

//   constructor(
//     @InjectModel(FeedItem.name)
//     private readonly feedItemModel: Model<FeedItemDocument>,
//     private readonly snapshotRepo: SnapshotRepository,
//     @Inject('GROUP_SERVICE') private readonly groupClient: ClientProxy,
//     @Inject('POST_SERVICE') private readonly postClient: ClientProxy,
//     private readonly affinityService: AffinityService,
//     private readonly emotionService: EmotionFeatureService,
//     @InjectRedis() private readonly redis: Redis,
//   ) {}

//   async getUserFeed(
//     userId: string,
//     query: PersonalFeedQuery,
//   ): Promise<CursorPageResponse<FeedItemDTO>> {
//     const limit = query.limit ?? 10;

//     const cursorData = PersonalFeedHelper.decodeCursor(query.cursor);

//     const sessionKey = `feed:session:${userId}:${query.mainEmotion || 'all'}`;

//     let session: FeedSession = {
//       heap: [],
//       offset: 0,
//       hasMore: true,
//     };

//     const cached = await this.redis.get(sessionKey);
//     if (cached) {
//       session = JSON.parse(cached);
//     }

//     const heap = new MinHeap(this.TOP_K);

//     // restore heap
//     for (const item of session.heap) {
//       heap.push(item);
//     }

//     /**
//      * LOAD MORE WINDOW nếu cần
//      */
//     if (heap.toSortedDesc().length < limit + 20 && session.hasMore) {
//       const candidates = await this.feedItemModel
//         .find({ userId })
//         .sort({ createdAt: -1 })
//         .skip(session.offset)
//         .limit(this.WINDOW_SIZE)
//         .lean();

//       this.logger.debug(
//         `[FEED] load window offset=${session.offset}, size=${candidates.length}`,
//       );

//       if (candidates.length < this.WINDOW_SIZE) {
//         session.hasMore = false;
//       }

//       session.offset += candidates.length;

//       const itemMapLocal = new Map(
//         candidates.map((i) => [i._id.toString(), i]),
//       );

//       const postMap = await this.loadLightPosts(candidates, query.mainEmotion);

//       const [emotionFeatures, affinity] = await Promise.all([
//         this.emotionService.getEmotionFeatures(userId),
//         this.affinityService.getAffinity(userId),
//       ]);

//       for (const item of candidates) {
//         const post = postMap.get(item.postId);
//         if (!post) continue;

//         const recency = PersonalFeedHelper.calcRecency(item.createdAt);

//         const emotionScore = emotionFeatures
//           ? this.emotionService.calcEmotionScore(emotionFeatures, {
//               scores: post.emotionFeature?.scores || {},
//               intensity: post.emotionFeature?.intensity,
//               confidence: post.emotionFeature?.confidence,
//               riskHintLevel: post.emotionFeature?.riskHintLevel,
//             })
//           : 0;

//         const affinityScore = this.affinityService.calcAffinityScore(affinity, {
//           category: post.emotionFeature?.label || 'neutral',
//           authorId: post.userId,
//         });

//         const engagement = PersonalFeedHelper.calcEngagement(post.stats);

//         const score = PersonalFeedHelper.calcFinalScore({
//           recency,
//           emotion: emotionScore,
//           affinity: affinityScore,
//           engagement,
//         });

//         heap.push({
//           itemId: item._id.toString(),
//           score,
//         });
//       }
//     }

//     /**
//      * SAVE SESSION
//      */
//     const ranked = heap.toSortedDesc();

//     session.heap = ranked;

//     await this.redis.setex(
//       sessionKey,
//       this.SESSION_TTL,
//       JSON.stringify(session),
//     );

//     /**
//      * PAGING (cursor-based)
//      */
//     let startIndex = 0;

//     if (cursorData) {
//       const index = ranked.findIndex(
//         (x) =>
//           x.score < cursorData.score ||
//           (x.score === cursorData.score && x.itemId < cursorData.itemId),
//       );

//       if (index !== -1) startIndex = index;
//     }

//     const page = ranked.slice(startIndex, startIndex + limit);

//     /**
//      * LOAD REAL ITEMS
//      */
//     const itemIds = page.map((p) => p.itemId);

//     const feedItems = await this.feedItemModel
//       .find({ _id: { $in: itemIds } })
//       .lean();

//     const itemMap = new Map(feedItems.map((i) => [i._id.toString(), i]));

//     const orderedItems = itemIds
//       .map((id) => itemMap.get(id))
//       .filter(Boolean) as FeedItem[];

//     /**
//      * ENRICH
//      */
//     const { postMapFull, shareMapFull, postReactions, shareReactions } =
//       await this.enrichFinalItems(userId, orderedItems);

//     const data = this.buildFeedDTO(
//       orderedItems,
//       postMapFull,
//       shareMapFull,
//       postReactions,
//       shareReactions,
//     );

//     /**
//      * NEXT CURSOR
//      */
//     let nextCursor: string | null = null;

//     const last = page[page.length - 1];

//     if (page.length === limit && last) {
//       nextCursor = PersonalFeedHelper.encodeCursor(
//         last.score,
//         last.itemId,
//         new Date(),
//       );
//     }

//     return new CursorPageResponse(data, nextCursor, !!nextCursor);
//   }

//   private async loadLightPosts(items: FeedItem[], mainEmotion?: string) {
//     const postIds = Array.from(new Set(items.map((i) => i.postId)));

//     const posts = await this.snapshotRepo.findPostsForRanking(
//       postIds,
//       mainEmotion ? mainEmotion.toLowerCase() : undefined,
//     );

//     return new Map(posts.map((p) => [p.postId, p]));
//   }

//   /**
//    * ENRICH FINAL ITEMS ONLY
//    */
//   private async enrichFinalItems(userId: string, items: FeedItem[]) {
//     const postIds: string[] = [];
//     const shareIds: string[] = [];

//     for (const item of items) {
//       if (item.eventType === FeedEventType.POST) {
//         postIds.push(item.refId);
//       } else {
//         shareIds.push(item.refId);
//       }
//     }

//     const [posts, shares] = await Promise.all([
//       this.snapshotRepo.findPostsByIds(postIds),
//       this.snapshotRepo.findSharesByIds(shareIds),
//     ]);

//     const postMap = new Map(posts.map((p) => [p.postId, p]));
//     const shareMap = new Map(shares.map((s) => [s.shareId, s]));

//     /**
//      * LOAD REACTIONS (ONLY FINAL)
//      */
//     const [postReactions, shareReactions] = await Promise.all([
//       postIds.length
//         ? firstValueFrom(
//             this.postClient.send<Record<string, ReactionType>>(
//               'get_reacted_types_batch',
//               {
//                 userId,
//                 targetType: TargetType.POST,
//                 targetIds: postIds,
//               },
//             ),
//           )
//         : Promise.resolve({}),
//       shareIds.length
//         ? firstValueFrom(
//             this.postClient.send<Record<string, ReactionType>>(
//               'get_reacted_types_batch',
//               {
//                 userId,
//                 targetType: TargetType.SHARE,
//                 targetIds: shareIds,
//               },
//             ),
//           )
//         : Promise.resolve({}),
//     ]);

//     /**
//      * LOAD GROUP
//      */
//     const groupIds = new Set<string>();
//     for (const p of posts) {
//       if (p.groupId) groupIds.add(p.groupId);
//     }

//     const groupMap = new Map<string, any>();

//     if (groupIds.size > 0) {
//       const groups = await firstValueFrom(
//         this.groupClient.send<any[]>(
//           'get_group_info_batch',
//           Array.from(groupIds),
//         ),
//       );

//       for (const g of groups) {
//         groupMap.set(g.id, g);
//       }
//     }

//     for (const post of posts) {
//       if (post.groupId) {
//         (post as any).group = groupMap.get(post.groupId);
//       }
//     }

//     for (const share of shares) {
//       const post = postMap.get(share.postId);
//       if (post?.groupId) {
//         (share as any).group = groupMap.get(post.groupId);
//       }
//     }

//     return {
//       postMapFull: postMap,
//       shareMapFull: shareMap,
//       postReactions,
//       shareReactions,
//     };
//   }

//   /**
//    * BUILD DTO
//    */
//   private buildFeedDTO(
//     items: FeedItem[],
//     postMap: Map<string, any>,
//     shareMap: Map<string, any>,
//     postReactions: Record<string, ReactionType>,
//     shareReactions: Record<string, ReactionType>,
//   ): FeedItemDTO[] {
//     const result: FeedItemDTO[] = [];

//     for (const item of items) {
//       if (item.eventType === FeedEventType.POST) {
//         const post = postMap.get(item.refId);
//         if (!post) continue;

//         result.push({
//           id: item._id?.toString() ?? '',
//           type: FeedEventType.POST,
//           item: SnapshotMapper.toPostSnapshotDTO(
//             post,
//             postReactions[item.refId],
//           ),
//         });
//       } else {
//         const share = shareMap.get(item.refId);
//         if (!share) continue;

//         const post = postMap.get(share.postId);
//         if (!post) continue;

//         result.push({
//           id: item._id?.toString() ?? '',
//           type: FeedEventType.SHARE,
//           item: SnapshotMapper.toShareSnapshotDTO(
//             share,
//             post,
//             shareReactions[item.refId],
//           ),
//         });
//       }
//     }

//     return result;
//   }
// }
