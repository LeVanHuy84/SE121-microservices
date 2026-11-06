import { Test, TestingModule } from '@nestjs/testing';
import { PostConsumerService } from './post-consumer.service';
import { PostIndexService } from '../../post/post-index.service';
import { Emotion, ModerationAction, TargetType } from '@repo/dtos';

describe('PostConsumerService', () => {
  let service: PostConsumerService;
  let postIndexService: {
    indexDocument: jest.Mock;
    updatePartialDocument: jest.Mock;
    deleteDocument: jest.Mock;
  };

  beforeEach(async () => {
    postIndexService = {
      indexDocument: jest.fn(),
      updatePartialDocument: jest.fn(),
      deleteDocument: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostConsumerService,
        {
          provide: PostIndexService,
          useValue: postIndexService,
        },
      ],
    }).compile();

    service = module.get<PostConsumerService>(PostConsumerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPostIndex', () => {
    it('should index post document with all fields', () => {
      const payload: any = {
        postId: 'post-1',
        userId: 'user-1',
        groupId: 'group-1',
        content: 'Post text content',
        createdAt: '2026-01-01T00:00:00Z',
      };

      service.createPostIndex(payload);

      expect(postIndexService.indexDocument).toHaveBeenCalledWith('post-1', {
        id: 'post-1',
        userId: 'user-1',
        groupId: 'group-1',
        content: 'Post text content',
        createdAt: '2026-01-01T00:00:00Z',
      });
    });
  });

  describe('updatePostIndex', () => {
    it('should update content of the post document', () => {
      const payload: any = {
        postId: 'post-1',
        content: 'Updated post content',
      };

      service.updatePostIndex(payload);

      expect(postIndexService.updatePartialDocument).toHaveBeenCalledWith(
        'post-1',
        {
          content: 'Updated post content',
        },
      );
    });
  });

  describe('removePostIndex', () => {
    it('should delete post document from index', () => {
      const payload: any = {
        postId: 'post-1',
      };

      service.removePostIndex(payload);

      expect(postIndexService.deleteDocument).toHaveBeenCalledWith('post-1');
    });
  });

  describe('handleEmotionResult', () => {
    it('should skip if targetType is not POST', () => {
      service.handleEmotionResult({
        targetType: TargetType.COMMENT,
        targetId: 'msg-1',
      } as any);

      expect(postIndexService.deleteDocument).not.toHaveBeenCalled();
      expect(postIndexService.updatePartialDocument).not.toHaveBeenCalled();
    });

    it('should delete post document when moderation action is HARD_BLOCK', () => {
      service.handleEmotionResult({
        targetType: TargetType.POST,
        targetId: 'post-1',
        moderation: {
          action: ModerationAction.HARD_BLOCK,
        },
      } as any);

      expect(postIndexService.deleteDocument).toHaveBeenCalledWith('post-1');
      expect(postIndexService.updatePartialDocument).not.toHaveBeenCalled();
    });

    it('should update mainEmotion when primaryEmotion is present', () => {
      service.handleEmotionResult({
        targetType: TargetType.POST,
        targetId: 'post-1',
        primaryEmotion: Emotion.JOY,
      } as any);

      expect(postIndexService.updatePartialDocument).toHaveBeenCalledWith(
        'post-1',
        {
          mainEmotion: Emotion.JOY,
        },
      );
    });

    it('should do nothing if primaryEmotion is undefined and not hard blocked', () => {
      service.handleEmotionResult({
        targetType: TargetType.POST,
        targetId: 'post-1',
      } as any);

      expect(postIndexService.deleteDocument).not.toHaveBeenCalled();
      expect(postIndexService.updatePartialDocument).not.toHaveBeenCalled();
    });
  });
});
