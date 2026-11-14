import { Test, TestingModule } from '@nestjs/testing';
import { KafkaConsumerController } from './kafka-consumer.controller';
import { PostConsumerService } from './service/post-consumer.service';
import { GroupConsumerService } from './service/group-consumer.service';
import { UserConsumerService } from './service/user-consumer.service';
import { RecommendationConsumerService } from './service/recommendation-consumer.service';
import { KafkaConsumerHelper } from '@repo/common';
import {
  EventTopic,
  GroupEventType,
  PostEventType,
  TargetType,
  UserEventType,
} from '@repo/dtos';
import { KafkaContext } from '@nestjs/microservices';

describe('KafkaConsumerController', () => {
  let controller: KafkaConsumerController;
  let postConsumer: {
    createPostIndex: jest.Mock;
    updatePostIndex: jest.Mock;
    removePostIndex: jest.Mock;
    handleEmotionResult: jest.Mock;
  };
  let groupConsumer: {
    createGroupIndex: jest.Mock;
    updateGroupIndex: jest.Mock;
    removeGroupIndex: jest.Mock;
  };
  let userConsumer: {
    createUserIndex: jest.Mock;
    updateUserIndex: jest.Mock;
    removeUserIndex: jest.Mock;
  };
  let recommendationConsumer: {
    handleProfileEmbeddingRequested: jest.Mock;
    handleGraphEvent: jest.Mock;
    handleEmotionEvent: jest.Mock;
  };
  let consumerHelper: {
    handleStateless: jest.Mock;
  };

  const createMockContext = (
    topic: string,
    key = 'test-key',
    offset = '10',
    partition = 0,
  ) =>
    ({
      getTopic: () => topic,
      getPartition: () => partition,
      getMessage: () => ({ key: Buffer.from(key), offset }),
    }) as unknown as KafkaContext;

  beforeEach(async () => {
    postConsumer = {
      createPostIndex: jest.fn(),
      updatePostIndex: jest.fn(),
      removePostIndex: jest.fn(),
      handleEmotionResult: jest.fn(),
    };
    groupConsumer = {
      createGroupIndex: jest.fn(),
      updateGroupIndex: jest.fn(),
      removeGroupIndex: jest.fn(),
    };
    userConsumer = {
      createUserIndex: jest.fn(),
      updateUserIndex: jest.fn(),
      removeUserIndex: jest.fn(),
    };
    recommendationConsumer = {
      handleProfileEmbeddingRequested: jest.fn().mockResolvedValue(undefined),
      handleGraphEvent: jest.fn().mockResolvedValue(undefined),
      handleEmotionEvent: jest.fn().mockResolvedValue(undefined),
    };
    consumerHelper = {
      handleStateless: jest.fn().mockImplementation(async ({ handler }) => {
        return await handler();
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KafkaConsumerController],
      providers: [
        { provide: PostConsumerService, useValue: postConsumer },
        { provide: GroupConsumerService, useValue: groupConsumer },
        { provide: UserConsumerService, useValue: userConsumer },
        {
          provide: RecommendationConsumerService,
          useValue: recommendationConsumer,
        },
        { provide: KafkaConsumerHelper, useValue: consumerHelper },
      ],
    }).compile();

    controller = module.get<KafkaConsumerController>(KafkaConsumerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handlePostEvents', () => {
    it('should handle PostEventType.CREATED', async () => {
      const payload: any = { postId: 'p1', userId: 'u1', content: 'test post' };
      const message: any = { type: PostEventType.CREATED, payload };
      const ctx = createMockContext(EventTopic.POST);

      await controller.handlePostEvents(message, ctx);

      expect(consumerHelper.handleStateless).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: EventTopic.POST,
          eventId: 'test-key',
        }),
      );
      expect(postConsumer.createPostIndex).toHaveBeenCalledWith(payload);
    });

    it('should handle PostEventType.UPDATED', async () => {
      const payload: any = { postId: 'p1', content: 'updated post' };
      const message: any = { type: PostEventType.UPDATED, payload };
      const ctx = createMockContext(EventTopic.POST);

      await controller.handlePostEvents(message, ctx);
      expect(postConsumer.updatePostIndex).toHaveBeenCalledWith(payload);
    });

    it('should handle PostEventType.REMOVED', async () => {
      const payload: any = { postId: 'p1' };
      const message: any = { type: PostEventType.REMOVED, payload };
      const ctx = createMockContext(EventTopic.POST);

      await controller.handlePostEvents(message, ctx);
      expect(postConsumer.removePostIndex).toHaveBeenCalledWith(payload);
    });

    it('should ignore unknown post event types', async () => {
      const message: any = { type: 'UNKNOWN_TYPE', payload: {} };
      const ctx = createMockContext(EventTopic.POST);

      await controller.handlePostEvents(message, ctx);
      expect(postConsumer.createPostIndex).not.toHaveBeenCalled();
      expect(postConsumer.updatePostIndex).not.toHaveBeenCalled();
      expect(postConsumer.removePostIndex).not.toHaveBeenCalled();
    });
  });

  describe('handleGroupEvents', () => {
    it('should handle GroupEventType.CREATED', async () => {
      const payload: any = { groupId: 'g1', name: 'Group 1' };
      const message: any = { type: GroupEventType.CREATED, payload };
      const ctx = createMockContext(EventTopic.GROUP_CRUD);

      await controller.handleGroupEvents(message, ctx);
      expect(groupConsumer.createGroupIndex).toHaveBeenCalledWith(payload);
    });

    it('should handle GroupEventType.UPDATED', async () => {
      const payload: any = { groupId: 'g1', name: 'Group Updated' };
      const message: any = { type: GroupEventType.UPDATED, payload };
      const ctx = createMockContext(EventTopic.GROUP_CRUD);

      await controller.handleGroupEvents(message, ctx);
      expect(groupConsumer.updateGroupIndex).toHaveBeenCalledWith(payload);
    });

    it('should handle GroupEventType.REMOVED', async () => {
      const payload: any = { groupId: 'g1' };
      const message: any = { type: GroupEventType.REMOVED, payload };
      const ctx = createMockContext(EventTopic.GROUP_CRUD);

      await controller.handleGroupEvents(message, ctx);
      expect(groupConsumer.removeGroupIndex).toHaveBeenCalledWith(payload);
    });
  });

  describe('handleUserEvents', () => {
    it('should handle UserEventType.CREATED', async () => {
      const payload: any = { userId: 'u1', firstName: 'John', lastName: 'Doe' };
      const message: any = { type: UserEventType.CREATED, payload };
      const ctx = createMockContext(EventTopic.USER);

      await controller.handleUserEvents(message, ctx);
      expect(userConsumer.createUserIndex).toHaveBeenCalledWith(payload);
    });

    it('should handle UserEventType.UPDATED', async () => {
      const payload: any = { userId: 'u1', bio: 'Updated bio' };
      const message: any = { type: UserEventType.UPDATED, payload };
      const ctx = createMockContext(EventTopic.USER);

      await controller.handleUserEvents(message, ctx);
      expect(userConsumer.updateUserIndex).toHaveBeenCalledWith(payload);
    });

    it('should handle UserEventType.REMOVED', async () => {
      const payload: any = { userId: 'u1' };
      const message: any = { type: UserEventType.REMOVED, payload };
      const ctx = createMockContext(EventTopic.USER);

      await controller.handleUserEvents(message, ctx);
      expect(userConsumer.removeUserIndex).toHaveBeenCalledWith(payload);
    });
  });

  describe('handleEmotionResultEvents', () => {
    it('should dispatch to postConsumer when targetType is POST', async () => {
      const payload: any = {
        targetType: TargetType.POST,
        targetId: 'p1',
        primaryEmotion: 'joy',
      };
      const message: any = { payload };
      const ctx = createMockContext(EventTopic.ANALYSIS_RESULT);

      await controller.handleEmotionResultEvents(message, ctx);
      expect(postConsumer.handleEmotionResult).toHaveBeenCalledWith(payload);
    });

    it('should not dispatch to postConsumer when targetType is not POST', async () => {
      const payload: any = { targetType: TargetType.COMMENT, targetId: 'm1' };
      const message: any = { payload };
      const ctx = createMockContext(EventTopic.ANALYSIS_RESULT);

      await controller.handleEmotionResultEvents(message, ctx);
      expect(postConsumer.handleEmotionResult).not.toHaveBeenCalled();
    });
  });

  describe('handleRecommendationProfileEvents', () => {
    it('should call handleProfileEmbeddingRequested with payload', async () => {
      const payload = {
        userId: 'u1',
        requestId: 'r1',
        semanticProfileText: 'profile text',
      };
      const message = { type: 'profile.requested', payload };
      const ctx = createMockContext(EventTopic.RECOMMENDATION_PROFILE);

      await controller.handleRecommendationProfileEvents(message, ctx);
      expect(
        recommendationConsumer.handleProfileEmbeddingRequested,
      ).toHaveBeenCalledWith(payload);
    });
  });

  describe('handleRecommendationGraphEvents', () => {
    it('should call handleGraphEvent with type and payload', async () => {
      const payload = { userId: 'u1', targetUserId: 'u2' };
      const message = {
        type: 'recommendation.graph.friend-request-sent',
        payload,
      };
      const ctx = createMockContext(EventTopic.RECOMMENDATION_GRAPH);

      await controller.handleRecommendationGraphEvents(message, ctx);
      expect(recommendationConsumer.handleGraphEvent).toHaveBeenCalledWith(
        'recommendation.graph.friend-request-sent',
        payload,
      );
    });
  });

  describe('handleRecommendationEmotionEvents', () => {
    it('should call handleEmotionEvent with type and payload', async () => {
      const payload = { userId: 'u1', riskScore: 0.2 };
      const message = { type: 'emotion.profile.updated', payload };
      const ctx = createMockContext('recommendation-emotion-events');

      await controller.handleRecommendationEmotionEvents(message, ctx);
      expect(recommendationConsumer.handleEmotionEvent).toHaveBeenCalledWith(
        'emotion.profile.updated',
        payload,
      );
    });
  });
});
