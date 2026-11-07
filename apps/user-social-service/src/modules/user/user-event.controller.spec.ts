import { Test, TestingModule } from "@nestjs/testing";
import { UserEventController } from "./user-event.controller";
import { UserService } from "./user.service";
import { KafkaConsumerHelper } from "@repo/common";
import {
  EventTopic,
  PostEventType,
  RecommendationGraphEventType,
} from "@repo/dtos";
import type {
  PostEventMessage,
  RecommendationGraphEventMessage,
} from "@repo/dtos";

describe("UserEventController (Idempotency Guard & Event Handling)", () => {
  let controller: UserEventController;
  let mockUserService: Partial<Record<keyof UserService, jest.Mock>>;
  let mockConsumerHelper: { handleStateless: jest.Mock };

  beforeEach(async () => {
    mockUserService = {
      incrementPostCount: jest.fn().mockResolvedValue(undefined),
      decrementPostCount: jest.fn().mockResolvedValue(undefined),
      incrementFriendCount: jest.fn().mockResolvedValue(undefined),
      decrementFriendCount: jest.fn().mockResolvedValue(undefined),
    };

    mockConsumerHelper = {
      handleStateless: jest.fn().mockImplementation(async ({ handler }) => {
        await handler();
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserEventController],
      providers: [
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: KafkaConsumerHelper,
          useValue: mockConsumerHelper,
        },
      ],
    }).compile();

    controller = module.get<UserEventController>(UserEventController);
  });

  const mockKafkaContext = (topic: string, offset = "10") =>
    ({
      getTopic: () => topic,
      getPartition: () => 0,
      getMessage: () => ({ key: Buffer.from("evt-key-1"), offset }),
    }) as any;

  describe("handlePostEvent with Idempotency", () => {
    it("should ignore post count increments when post belongs to a community group", async () => {
      const message: PostEventMessage = {
        type: PostEventType.CREATED,
        topic: EventTopic.POST,
        payload: {
          postId: "p-1",
          userId: "u-1",
          groupId: "grp-1",
        } as any,
      };

      await controller.handlePostEvent(
        message,
        mockKafkaContext(EventTopic.POST),
      );

      expect(mockConsumerHelper.handleStateless).not.toHaveBeenCalled();
      expect(mockUserService.incrementPostCount).not.toHaveBeenCalled();
    });

    it("should route CREATED post event through handleStateless and increment postCount", async () => {
      const message: PostEventMessage = {
        type: PostEventType.CREATED,
        topic: EventTopic.POST,
        payload: {
          postId: "p-1",
          userId: "u-1",
        } as any,
      };

      await controller.handlePostEvent(
        message,
        mockKafkaContext(EventTopic.POST),
      );

      expect(mockConsumerHelper.handleStateless).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: EventTopic.POST,
          eventId: "evt-key-1",
        }),
      );
      expect(mockUserService.incrementPostCount).toHaveBeenCalledWith("u-1");
    });

    it("should route REMOVED post event through handleStateless and decrement postCount", async () => {
      const message: PostEventMessage = {
        type: PostEventType.REMOVED,
        topic: EventTopic.POST,
        payload: {
          postId: "p-1",
          userId: "u-1",
        } as any,
      };

      await controller.handlePostEvent(
        message,
        mockKafkaContext(EventTopic.POST),
      );

      expect(mockConsumerHelper.handleStateless).toHaveBeenCalled();
      expect(mockUserService.decrementPostCount).toHaveBeenCalledWith("u-1");
    });
  });

  describe("handleGraphEvent with Idempotency", () => {
    it("should route FRIEND_REQUEST_ACCEPTED event and increment friendCount for both users", async () => {
      const message: RecommendationGraphEventMessage = {
        type: RecommendationGraphEventType.FRIEND_REQUEST_ACCEPTED,
        payload: {
          userId: "u-1",
          targetUserId: "u-2",
        } as any,
      };

      await controller.handleGraphEvent(
        message,
        mockKafkaContext(EventTopic.RECOMMENDATION_GRAPH),
      );

      expect(mockConsumerHelper.handleStateless).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: EventTopic.RECOMMENDATION_GRAPH,
        }),
      );
      expect(mockUserService.incrementFriendCount).toHaveBeenCalledWith([
        "u-1",
        "u-2",
      ]);
    });

    it("should route FRIENDSHIP_REMOVED event and decrement friendCount for both users", async () => {
      const message: RecommendationGraphEventMessage = {
        type: RecommendationGraphEventType.FRIENDSHIP_REMOVED,
        payload: {
          userId: "u-1",
          targetUserId: "u-2",
        } as any,
      };

      await controller.handleGraphEvent(
        message,
        mockKafkaContext(EventTopic.RECOMMENDATION_GRAPH),
      );

      expect(mockConsumerHelper.handleStateless).toHaveBeenCalled();
      expect(mockUserService.decrementFriendCount).toHaveBeenCalledWith([
        "u-1",
        "u-2",
      ]);
    });
  });
});
