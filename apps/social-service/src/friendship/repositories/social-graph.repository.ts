import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';

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
}

export interface SocialGraphRepository {
  getRelationshipStatus(
    userId: string,
    targetId: string,
  ): Promise<{ status: RelationshipStatus }>;
  sendFriendRequest(userId: string, targetId: string): Promise<void>;
  cancelFriendRequest(userId: string, targetId: string): Promise<void>;
  acceptFriendRequest(userId: string, requesterId: string): Promise<void>;
  declineFriendRequest(userId: string, requesterId: string): Promise<void>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  blockUser(userId: string, targetId: string): Promise<void>;
  unblockUser(userId: string, targetId: string): Promise<void>;
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
  getFriendIds(userId: string, limit?: number): Promise<string[]>;
  getBlockedUsers(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>>;
}

export const SOCIAL_GRAPH_REPOSITORY = 'SOCIAL_GRAPH_REPOSITORY';
