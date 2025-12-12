import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AnalysisResultEventPayload, Emotion, TargetType } from '@repo/dtos';
import { Comment } from 'src/entities/comment.entity';
import { Post } from 'src/entities/post.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ConsumerService {
  constructor(
    @InjectRepository(Post) private readonly postRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>
  ) {}

  async handleCreated(payload: AnalysisResultEventPayload): Promise<void> {
    // Xử lý sự kiện CREATED ở đây
    console.log('Handling CREATED event:', payload);
    switch (payload.targetType) {
      case TargetType.POST:
        const post = await this.postRepository.findOneBy({
          id: payload.targetId,
        });
        if (post) {
          post.mainEmotion = payload.finalEmotion as Emotion;
          post.mainEmotionScore = payload.score;
          await this.postRepository.save(post);
        }
        break;
      case TargetType.COMMENT:
        const comment = await this.commentRepository.findOneBy({
          id: payload.targetId,
        });
        if (comment) {
          comment.mainEmotion = payload.finalEmotion as Emotion;
          comment.mainEmotionScore = payload.score;
          await this.commentRepository.save(comment);
        }
        break;
    }
  }

  async handleUpdated(payload: AnalysisResultEventPayload): Promise<void> {
    // Xử lý sự kiện UPDATED ở đây
    console.log('Handling UPDATED event:', payload);
    switch (payload.targetType) {
      case TargetType.POST:
        const post = await this.postRepository.findOneBy({
          id: payload.targetId,
        });
        if (post) {
          post.mainEmotion = payload.finalEmotion as Emotion;
          post.mainEmotionScore = payload.score;
          await this.postRepository.save(post);
        }
        break;
      case TargetType.COMMENT:
        const comment = await this.commentRepository.findOneBy({
          id: payload.targetId,
        });
        if (comment) {
          comment.mainEmotion = payload.finalEmotion as Emotion;
          comment.mainEmotionScore = payload.score;
          await this.commentRepository.save(comment);
        }
        break;
    }
  }
}
