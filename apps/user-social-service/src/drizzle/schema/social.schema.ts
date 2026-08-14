import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ===================================================
// TABLES
// ===================================================

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    friendId: varchar("friend_id", { length: 255 }).notNull(),
    since: timestamp("since", { withTimezone: true }).defaultNow().notNull(),
    sentimentScore: doublePrecision("sentiment_score").default(0).notNull(),
  },
  (t) => ({
    uqFriendshipUserFriend: uniqueIndex("uq_friendship_user_friend").on(
      t.userId,
      t.friendId,
    ),
    idxFriendshipUserFriend: index("idx_friendship_user_friend").on(
      t.userId,
      t.friendId,
    ),
    idxFriendshipUserSince: index("idx_friendship_user_since").on(
      t.userId,
      t.since,
    ),
  }),
);

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requesterId: varchar("requester_id", { length: 255 }).notNull(),
    receiverId: varchar("receiver_id", { length: 255 }).notNull(),
    recommendationId: varchar("recommendation_id", { length: 255 }),
    recommendationRequestId: varchar("recommendation_request_id", {
      length: 255,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqFriendRequestRequesterReceiver: uniqueIndex(
      "uq_friend_request_requester_receiver",
    ).on(t.requesterId, t.receiverId),
    idxFriendRequestReceiverRequester: index(
      "idx_friend_request_receiver_requester",
    ).on(t.receiverId, t.requesterId),
  }),
);

export const userBlocks = pgTable(
  "user_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blockerId: varchar("blocker_id", { length: 255 }).notNull(),
    blockedId: varchar("blocked_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqUserBlockBlockerBlocked: uniqueIndex("uq_user_block_blocker_blocked").on(
      t.blockerId,
      t.blockedId,
    ),
    idxUserBlockBlockerBlocked: index("idx_user_block_blocker_blocked").on(
      t.blockerId,
      t.blockedId,
    ),
  }),
);

export const friendRecommendationDismissals = pgTable(
  "friend_recommendation_dismissals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    candidateId: varchar("candidate_id", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uqFriendRecDismissalUserCandidate: uniqueIndex(
      "uq_friend_recommendation_dismissal_user_candidate",
    ).on(t.userId, t.candidateId),
    idxFriendRecDismissalUserCandidate: index(
      "idx_friend_recommendation_dismissal_user_candidate",
    ).on(t.userId, t.candidateId),
    idxFriendRecDismissalUserExpires: index(
      "idx_friend_recommendation_dismissal_user_expires",
    ).on(t.userId, t.expiresAt),
  }),
);

export const friendRecommendationEvents = pgTable(
  "friend_recommendation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    candidateId: varchar("candidate_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 255 }).notNull(),
    recommendationId: varchar("recommendation_id", { length: 255 }),
    recommendationRequestId: varchar("recommendation_request_id", {
      length: 255,
    }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idxFriendRecEventUserCreatedAt: index(
      "idx_friend_recommendation_event_user_created_at",
    ).on(t.userId, t.createdAt),
    idxFriendRecEventRecId: index(
      "idx_friend_recommendation_event_recommendation_id",
    ).on(t.recommendationId),
    idxFriendRecEventReqId: index(
      "idx_friend_recommendation_event_request_id",
    ).on(t.recommendationRequestId),
  }),
);

// ===================================================
// INFERRED TYPES
// ===================================================

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;

export type FriendRequest = typeof friendRequests.$inferSelect;
export type NewFriendRequest = typeof friendRequests.$inferInsert;

export type UserBlock = typeof userBlocks.$inferSelect;
export type NewUserBlock = typeof userBlocks.$inferInsert;

export type FriendRecommendationDismissal =
  typeof friendRecommendationDismissals.$inferSelect;
export type NewFriendRecommendationDismissal =
  typeof friendRecommendationDismissals.$inferInsert;

export type FriendRecommendationEvent =
  typeof friendRecommendationEvents.$inferSelect;
export type NewFriendRecommendationEvent =
  typeof friendRecommendationEvents.$inferInsert;
