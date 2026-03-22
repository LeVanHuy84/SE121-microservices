import {
  BaseUserDTO,
  CursorPaginationDTO,
  CursorPageResponse,
} from '@repo/dtos';

export type RelationshipStatus =
  | 'NONE'
  | 'BLOCKED'
  | 'FRIEND'
  | 'REQUESTED_OUT'
  | 'REQUESTED_IN';

export interface FriendRecommendation {
  id: string;
  mutualFriends: number;
  mutualFriendIds: string[];
  profileMatchScore?: number;
  profileMatchedSignals?: string[];
  sharedInterestsCount?: number;
  semanticMatchScore?: number;
  user?: BaseUserDTO | null;
  mutualFriendPreview?: BaseUserDTO[];
  commonGroups?: number;
  commonGroupIds?: string[];
  baseScore?: number;
  modelScore?: number;
  score?: number;
  reasons?: string[];
  recommendationId?: string;
  recommendationRequestId?: string;
}

export type FriendRecommendationEventType =
  | 'served'
  | 'dismissed'
  | 'request_sent'
  | 'accepted';

export interface FriendRecommendationAttribution {
  recommendationId?: string;
  recommendationRequestId?: string;
}

export interface FriendRecommendationEvent {
  userId: string;
  candidateId: string;
  eventType: FriendRecommendationEventType;
  recommendationId?: string | null;
  recommendationRequestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AcceptedFriendRequestAttribution {
  recommendationId: string | null;
  recommendationRequestId: string | null;
}

export type FriendRecommendationAnalyticsSource =
  | 'mutual_only'
  | 'group_only'
  | 'profile_only'
  | 'semantic_only'
  | 'mixed'
  | 'fallback';

export interface FriendRecommendationAnalyticsTotals {
  served: number;
  dismissed: number;
  requestSent: number;
  accepted: number;
}

export interface FriendRecommendationAnalyticsSourceBreakdown
  extends FriendRecommendationAnalyticsTotals {
  source: FriendRecommendationAnalyticsSource;
}

export interface FriendRecommendationAnalyticsRates {
  dismissFromServed: number;
  requestSentFromServed: number;
  acceptFromServed: number;
  acceptFromRequests: number;
}

export interface FriendRecommendationAnalytics {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  totals: FriendRecommendationAnalyticsTotals;
  rates: FriendRecommendationAnalyticsRates;
  sources: FriendRecommendationAnalyticsSourceBreakdown[];
}

export interface SocialGraphRepository {
  getRelationshipStatus(
    userId: string,
    targetId: string,
  ): Promise<{ status: RelationshipStatus }>;
  sendFriendRequest(
    userId: string,
    targetId: string,
    attribution?: FriendRecommendationAttribution,
  ): Promise<void>;
  cancelFriendRequest(userId: string, targetId: string): Promise<void>;
  acceptFriendRequest(
    userId: string,
    requesterId: string,
  ): Promise<AcceptedFriendRequestAttribution | null>;
  declineFriendRequest(userId: string, requesterId: string): Promise<void>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  blockUser(userId: string, targetId: string): Promise<void>;
  unblockUser(userId: string, targetId: string): Promise<void>;
  dismissFriendRecommendation(
    userId: string,
    candidateId: string,
    expiresAt: Date,
  ): Promise<void>;
  getFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>>;
  getFriendRequests(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>>;
  recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>>;
  summarizeCandidates(
    userId: string,
    candidateIds: string[],
  ): Promise<FriendRecommendation[]>;
  getFriendIds(userId: string, limit?: number): Promise<string[]>;
  getBlockedUsers(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>>;
  getFriendRecommendationAnalytics(
    userId: string,
    since: Date,
  ): Promise<Omit<FriendRecommendationAnalytics, 'windowDays'>>;
  recordRecommendationEvents(
    events: FriendRecommendationEvent[],
  ): Promise<void>;
}

export const SOCIAL_GRAPH_REPOSITORY = 'SOCIAL_GRAPH_REPOSITORY';
