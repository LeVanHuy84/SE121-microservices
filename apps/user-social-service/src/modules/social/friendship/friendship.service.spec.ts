import { BadRequestException } from "@nestjs/common";
import { CursorPaginationDTO } from "@repo/dtos";
import { Test, TestingModule } from "@nestjs/testing";
import { RecentActivityBufferService } from "../event/recent-activity.buffer.service";
import { RecommendationQueryService } from "./recommendation/recommendation-query.service";
import { SOCIAL_GRAPH_REPOSITORY } from "./repositories/social-graph.repository";
import { UserService } from "../../user/user.service";
import { FriendshipService } from "./friendship.service";

describe("FriendshipService", () => {
  let service: FriendshipService;

  const dismissFriendRecommendation = jest.fn();
  const sendFriendRequest = jest.fn();
  const cancelFriendRequest = jest.fn();
  const acceptFriendRequest = jest.fn();
  const declineFriendRequest = jest.fn();
  const removeFriend = jest.fn();
  const blockUser = jest.fn();
  const unblockUser = jest.fn();
  const getRelationshipStatus = jest.fn();
  const getFriends = jest.fn();
  const getFriendRequests = jest.fn();
  const getBlockedUsers = jest.fn();
  const getFriendRecommendationAnalytics = jest.fn();
  const getGlobalFriendRecommendationAnalytics = jest.fn();
  const recordRecommendationEvents = jest.fn();
  const addRecentActivity = jest.fn();
  const clearActivity = jest.fn();
  const recommendFriends = jest.fn();
  const searchUserIds = jest.fn();
  const findOneUser = jest.fn();

  beforeEach(async () => {
    [
      dismissFriendRecommendation,
      sendFriendRequest,
      cancelFriendRequest,
      acceptFriendRequest,
      declineFriendRequest,
      removeFriend,
      blockUser,
      unblockUser,
      getRelationshipStatus,
      getFriends,
      getFriendRequests,
      getBlockedUsers,
      getFriendRecommendationAnalytics,
      getGlobalFriendRecommendationAnalytics,
      recordRecommendationEvents,
      addRecentActivity,
      clearActivity,
      recommendFriends,
      searchUserIds,
      findOneUser,
    ].forEach((mockFn) => mockFn.mockReset());

    getRelationshipStatus.mockResolvedValue({ status: "NONE" });
    sendFriendRequest.mockResolvedValue({ created: true });
    cancelFriendRequest.mockResolvedValue({ removed: true });
    acceptFriendRequest.mockResolvedValue(null);
    declineFriendRequest.mockResolvedValue({ removed: true });
    removeFriend.mockResolvedValue({ removed: true });
    blockUser.mockResolvedValue({ created: true });
    unblockUser.mockResolvedValue({ removed: true });
    getFriends.mockResolvedValue({
      data: [],
      nextCursor: null,
      hasNextPage: false,
    });
    getFriendRequests.mockResolvedValue({
      data: [],
      nextCursor: null,
      hasNextPage: false,
    });
    getBlockedUsers.mockResolvedValue({
      data: [],
      nextCursor: null,
      hasNextPage: false,
    });
    recommendFriends.mockResolvedValue({
      data: [],
      nextCursor: null,
      hasNextPage: false,
    });
    getFriendRecommendationAnalytics.mockResolvedValue({
      windowStart: "2026-03-01T00:00:00.000Z",
      windowEnd: "2026-03-18T00:00:00.000Z",
      totals: {
        served: 10,
        dismissed: 2,
        requestSent: 3,
        accepted: 1,
      },
      rates: {
        dismissFromServed: 0.2,
        requestSentFromServed: 0.3,
        acceptFromServed: 0.1,
        acceptFromRequests: 1 / 3,
      },
      sources: [],
      candidateSourceModes: [],
    });
    addRecentActivity.mockResolvedValue(undefined);
    clearActivity.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendshipService,
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            getRelationshipStatus,
            sendFriendRequest,
            cancelFriendRequest,
            acceptFriendRequest,
            declineFriendRequest,
            removeFriend,
            blockUser,
            unblockUser,
            dismissFriendRecommendation,
            getFriends,
            getFriendRequests,
            recommendFriends: jest.fn(),
            summarizeCandidates: jest.fn(),
            getFriendIds: jest.fn(),
            getBlockedUsers,
            getFriendRecommendationAnalytics,
            getGlobalFriendRecommendationAnalytics,
            recordRecommendationEvents,
          },
        },
        {
          provide: RecentActivityBufferService,
          useValue: {
            addRecentActivity,
            clearActivity,
          },
        },
        {
          provide: RecommendationQueryService,
          useValue: {
            recommendFriends,
          },
        },
        {
          provide: UserService,
          useValue: {
            searchUserIds,
            findOne: findOneUser,
          },
        },
      ],
    }).compile();

    service = module.get<FriendshipService>(FriendshipService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // Suite 2: Đồ thị Xã hội & Quan hệ Bạn bè (TC-FS-01 -> TC-FS-07)
  // ============================================================
  it("TC-FS-01: should send friend request successfully and record recent activity", async () => {
    const result = await service.sendFriendRequest("userA", "userB");

    expect(sendFriendRequest).toHaveBeenCalledWith("userA", "userB", undefined);
    expect(addRecentActivity).toHaveBeenCalledWith({
      actorId: "userA",
      targetId: "userB",
      type: "friendship_request",
    });
    expect(result.message).toBe("Friend request sent successfully");
  });

  it("TC-FS-02: should reject sending friend request to yourself", async () => {
    await expect(service.sendFriendRequest("userA", "userA")).rejects.toThrow(
      "Cannot send request to yourself",
    );
  });

  it("TC-FS-03: should reject sending friend request when already friends", async () => {
    getRelationshipStatus.mockResolvedValueOnce({ status: "FRIEND" });

    await expect(service.sendFriendRequest("userA", "userB")).rejects.toThrow(
      "Already friends",
    );
  });

  it("TC-FS-04: should reject sending friend request when blocked", async () => {
    getRelationshipStatus.mockResolvedValueOnce({ status: "BLOCKED" });

    await expect(service.sendFriendRequest("userA", "userB")).rejects.toThrow(
      "Cannot send request to a blocked user",
    );
  });

  it("TC-FS-05: should accept friend request and record activity", async () => {
    getRelationshipStatus.mockResolvedValueOnce({ status: "REQUESTED_IN" });
    acceptFriendRequest.mockResolvedValueOnce({ created: true });

    const result = await service.acceptFriendRequest("receiver", "requester");

    expect(acceptFriendRequest).toHaveBeenCalledWith("receiver", "requester");
    expect(clearActivity).toHaveBeenCalledWith(
      "friendship_request",
      "receiver",
      "requester",
    );
    expect(addRecentActivity).toHaveBeenCalledWith({
      actorId: "receiver",
      targetId: "requester",
      type: "friendship_accept",
    });
    expect(result.message).toBe("Friend request accepted");
  });

  it("TC-FS-06: should remove friend successfully", async () => {
    getRelationshipStatus.mockResolvedValueOnce({ status: "FRIEND" });
    removeFriend.mockResolvedValueOnce({ removed: true });

    const result = await service.removeFriend("userA", "userB");

    expect(removeFriend).toHaveBeenCalledWith("userA", "userB");
    expect(result.message).toBe("Friend removed successfully");
  });

  it("TC-FS-07: should dismiss friend recommendation with expiry", async () => {
    const before = Date.now();

    const result = await service.dismissFriendRecommendation("self", "target", {
      recommendationId: "rec-1",
      recommendationRequestId: "req-1",
    });

    expect(dismissFriendRecommendation).toHaveBeenCalledWith(
      "self",
      "target",
      expect.any(Date),
    );
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: "self",
        candidateId: "target",
        eventType: "dismissed",
        recommendationId: "rec-1",
        recommendationRequestId: "req-1",
      }),
    ]);
    expect(result.message).toBe("Friend recommendation dismissed successfully");
    expect(result.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it("should reject dismissing yourself", async () => {
    await expect(
      service.dismissFriendRecommendation("self", "self"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("should record request_sent when sending from recommendation", async () => {
    await service.sendFriendRequest("self", "target", {
      recommendationId: "rec-1",
      recommendationRequestId: "req-1",
    });

    expect(sendFriendRequest).toHaveBeenCalledWith("self", "target", {
      recommendationId: "rec-1",
      recommendationRequestId: "req-1",
    });
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      {
        userId: "self",
        candidateId: "target",
        eventType: "request_sent",
        recommendationId: "rec-1",
        recommendationRequestId: "req-1",
      },
    ]);
  });

  it("should reject duplicated friend request when repository reports no insert", async () => {
    sendFriendRequest.mockResolvedValueOnce({ created: false });

    await expect(
      service.sendFriendRequest("self", "target"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("should reject accepting request when repository detects race and returns null", async () => {
    getRelationshipStatus.mockResolvedValue({ status: "REQUESTED_IN" });
    acceptFriendRequest.mockResolvedValue(null);

    await expect(
      service.acceptFriendRequest("receiver", "requester"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("should clear pending request activity when declining a friend request", async () => {
    getRelationshipStatus.mockResolvedValue({ status: "REQUESTED_IN" });
    declineFriendRequest.mockResolvedValue({ removed: true });

    await service.declineFriendRequest("receiver", "requester");

    expect(clearActivity).toHaveBeenCalledWith(
      "friendship_request",
      "receiver",
      "requester",
    );
  });

  it("should return recommendation analytics with normalized window days", async () => {
    const result = await service.getFriendRecommendationAnalytics("self", 999);

    expect(getFriendRecommendationAnalytics).toHaveBeenCalledWith(
      "self",
      expect.any(Date),
    );
    expect(result.windowDays).toBe(365);
  });

  it("should normalize cursor query before querying friend requests", async () => {
    await service.getFriendRequests("self", {
      cursor: "  abc  ",
      limit: 999,
    } as CursorPaginationDTO);

    expect(getFriendRequests).toHaveBeenCalledWith("self", {
      cursor: "abc",
      limit: 50,
    });
  });

  it("should normalize recommendation query before calling recommendation service", async () => {
    await service.recommendFriends("self", {
      cursor: "   ",
      limit: 0,
    } as CursorPaginationDTO);

    expect(recommendFriends).toHaveBeenCalledWith("self", {
      cursor: undefined,
      limit: 1,
    });
  });
});
