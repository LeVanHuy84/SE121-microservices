import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { RpcException } from "@nestjs/microservices";
import { of, throwError } from "rxjs";
import { DistributionService } from "./distribution.service";
import { FeedItem } from "../../mongo/schema/feed-item.schema";
import { FeedEventType } from "@repo/dtos";
import { MICROSERVICES_CLIENT } from "src/constant";
import { Types } from "mongoose";

describe("DistributionService (Suite 5: TC-DIST-01 -> TC-DIST-03 Động cơ Fan-out)", () => {
  let service: DistributionService;
  let mockFeedItemModel: any;
  let mockUserSocialClient: any;

  beforeEach(async () => {
    mockFeedItemModel = {
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };

    mockUserSocialClient = {
      send: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DistributionService,
        {
          provide: getModelToken(FeedItem.name),
          useValue: mockFeedItemModel,
        },
        {
          provide: MICROSERVICES_CLIENT.USER_SOCIAL_SERVICE,
          useValue: mockUserSocialClient,
        },
      ],
    }).compile();

    service = module.get<DistributionService>(DistributionService);
  });

  // ============================================================
  // TC-DIST-01: Phân phối bài viết mới cho bạn bè thành công
  // ============================================================
  it("TC-DIST-01: should query friend IDs via RPC and bulk insert FeedItems into MongoDB", async () => {
    const actorId = "user-alice";
    const snapshotObjectId = new Types.ObjectId().toString();
    const postId = "post-100";
    const friendIds = Array.from({ length: 50 }, (_, i) => `friend-user-${i}`);

    mockUserSocialClient.send.mockReturnValueOnce(of(friendIds));

    await service.distributeCreated(
      FeedEventType.POST,
      snapshotObjectId,
      postId,
      postId,
      actorId,
    );

    expect(mockUserSocialClient.send).toHaveBeenCalledWith(
      { cmd: "get_friend_ids" },
      { userId: actorId, limit: 200 },
    );
    expect(mockFeedItemModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "friend-user-0",
          postId,
          eventType: FeedEventType.POST,
        }),
      ]),
      expect.anything(),
    );
    expect(mockFeedItemModel.insertMany.mock.calls[0][0]).toHaveLength(50);
  });

  // ============================================================
  // TC-DIST-02: Phân phối bài viết trong Group cho các thành viên
  // ============================================================
  it("TC-DIST-02: should query group member IDs via RPC and bulk insert FeedItems", async () => {
    const actorId = "user-alice";
    const groupId = "group-mindfulness-1";
    const snapshotObjectId = new Types.ObjectId().toString();
    const postId = "post-group-100";
    const memberIds = ["member-1", "member-2", "member-3"];

    mockUserSocialClient.send.mockReturnValueOnce(of(memberIds));

    await service.distributeCreated(
      FeedEventType.POST,
      snapshotObjectId,
      postId,
      postId,
      actorId,
      groupId,
    );

    expect(mockUserSocialClient.send).toHaveBeenCalledWith(
      "get_group_member_user_ids",
      { groupId },
    );
    expect(mockFeedItemModel.insertMany.mock.calls[0][0]).toHaveLength(3);
  });

  // ============================================================
  // TC-DIST-03: Khả năng chịu lỗi khi RPC user-social-service bị timeout
  // ============================================================
  it("TC-DIST-03: should throw RpcException safely when RPC client fails or times out", async () => {
    const actorId = "user-alice";
    const snapshotObjectId = new Types.ObjectId().toString();
    const postId = "post-fail-100";

    mockUserSocialClient.send.mockReturnValueOnce(
      throwError(() => new Error("Timeout has occurred")),
    );

    await expect(
      service.distributeCreated(
        FeedEventType.POST,
        snapshotObjectId,
        postId,
        postId,
        actorId,
      ),
    ).rejects.toThrow(RpcException);

    expect(mockFeedItemModel.insertMany).not.toHaveBeenCalled();
  });

  it("TC-DIST-03 (Resilience): should forward failure metadata to DLQ service when available upon timeout", async () => {
    const mockDlq = { send: jest.fn().mockResolvedValue(undefined) };
    const customService = new DistributionService(
      mockFeedItemModel,
      mockUserSocialClient,
      mockDlq as any,
    );

    mockUserSocialClient.send.mockReturnValueOnce(
      throwError(() => new Error("RPC Timeout 5000ms")),
    );

    await expect(
      customService.distributeCreated(
        FeedEventType.POST,
        "snap-1",
        "post-1",
        "post-1",
        "user-1",
      ),
    ).rejects.toThrow(RpcException);

    expect(mockDlq.send).toHaveBeenCalledWith(
      "feed-distribution-events",
      expect.objectContaining({
        snapshotId: "snap-1",
        postId: "post-1",
        actorId: "user-1",
      }),
      expect.any(Error),
    );
  });

  it("should remove snapshot and related feed items when distributeRemoved is called", async () => {
    const snapshotObjectId = new Types.ObjectId().toString();

    await service.distributeRemoved(snapshotObjectId);

    expect(mockFeedItemModel.deleteMany).toHaveBeenCalledWith(
      { snapshotId: new Types.ObjectId(snapshotObjectId) },
      expect.anything(),
    );
  });
});
