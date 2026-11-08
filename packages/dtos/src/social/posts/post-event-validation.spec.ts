import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePostDTO } from './create-post.dto';
import { UpdatePostDTO } from './update-post.dto';
import { ReactDTO } from '../reactions/react.dto';
import { DisReactDTO } from '../reactions/dis-react.dto';
import { Audience, Emotion, ReactionType, TargetType } from '../enums/social.enum';

describe('Post & Interaction DTOs Validation (TC-DTO-02 & TC-DTO-03)', () => {
  describe('CreatePostDTO', () => {
    it('TC-DTO-02: should pass validation when valid data is provided', async () => {
      const dto = plainToInstance(CreatePostDTO, {
        content: 'Sharing a positive mental health experience today!',
        feeling: Emotion.JOY,
        audience: Audience.PUBLIC,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('TC-DTO-02: should pass validation with minimum required fields (only content)', async () => {
      const dto = plainToInstance(CreatePostDTO, {
        content: 'Just a simple thought.',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('TC-DTO-03: should fail validation when content is empty or missing', async () => {
      const emptyContentDto = plainToInstance(CreatePostDTO, {
        content: '',
      });
      const errors = await validate(emptyContentDto);
      expect(errors.length).toBeGreaterThan(0);
      const contentError = errors.find((e) => e.property === 'content');
      expect(contentError).toBeDefined();

      const missingContentDto = plainToInstance(CreatePostDTO, {});
      const missingErrors = await validate(missingContentDto);
      expect(missingErrors.some((e) => e.property === 'content')).toBe(true);
    });

    it('TC-DTO-03: should fail validation when feeling or audience enum values are invalid', async () => {
      const invalidEnumDto = plainToInstance(CreatePostDTO, {
        content: 'Valid content text',
        feeling: 'SUPER_ANGRY' as any,
        audience: 'FRIENDS_OF_FRIENDS' as any,
      });

      const errors = await validate(invalidEnumDto);
      expect(errors.length).toBe(2);
      expect(errors.some((e) => e.property === 'feeling')).toBe(true);
      expect(errors.some((e) => e.property === 'audience')).toBe(true);
    });
  });

  describe('UpdatePostDTO', () => {
    it('should pass validation with valid partial updates', async () => {
      const dto = plainToInstance(UpdatePostDTO, {
        content: 'Updated content here',
        audience: Audience.ONLY_ME,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation with invalid audience enum', async () => {
      const dto = plainToInstance(UpdatePostDTO, {
        audience: 'UNKNOWN_AUDIENCE' as any,
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'audience')).toBe(true);
    });
  });

  describe('ReactDTO and DisReactDTO', () => {
    it('should pass validation with valid UUID and valid enum types', async () => {
      const reactDto = plainToInstance(ReactDTO, {
        targetId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        targetType: TargetType.POST,
        reactionType: ReactionType.LIKE,
      });

      const reactErrors = await validate(reactDto);
      expect(reactErrors.length).toBe(0);

      const disReactDto = plainToInstance(DisReactDTO, {
        targetId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        targetType: TargetType.POST,
      });

      const disReactErrors = await validate(disReactDto);
      expect(disReactErrors.length).toBe(0);
    });

    it('should fail validation when targetId is not a valid UUID', async () => {
      const invalidReactDto = plainToInstance(ReactDTO, {
        targetId: 'invalid-non-uuid-id',
        targetType: TargetType.POST,
        reactionType: ReactionType.LIKE,
      });

      const errors = await validate(invalidReactDto);
      expect(errors.some((e) => e.property === 'targetId')).toBe(true);
    });
  });
});

