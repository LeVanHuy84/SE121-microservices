import {
  Inject,
  Injectable,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import {
  TargetType,
  AnalysisSummaryDto,
  PostResponseDTO,
  CommentResponseDTO,
} from '@repo/dtos';
import { EmotionAnalyticsRepository } from './emotion-analytics.repository';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout } from 'rxjs';

@Injectable()
export class EmotionAnalyticsService {
  constructor(
    private readonly emotionAnalyticsRepository: EmotionAnalyticsRepository,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy,
  ) {}

  async getByTarget(payload: {
    userId: string;
    targetId: string;
    targetType: TargetType;
  }): Promise<AnalysisSummaryDto> {
    const { userId, targetId, targetType } = payload;

    const snapshot = await this.emotionAnalyticsRepository.findLatestByTarget(
      userId,
      targetId,
      targetType,
    );

    if (!snapshot) {
      throw new NotFoundException('Emotion analysis not found');
    }

    let content: PostResponseDTO | CommentResponseDTO;

    if (targetType === TargetType.POST || targetType === TargetType.COMMENT) {
      content = await firstValueFrom(
        this.postClient
          .send('internal.get_target_content', {
            targetId,
            targetType,
          })
          .pipe(
            timeout(5000),
            catchError((error) => {
              if (error.name === 'TimeoutError') {
                throw new RequestTimeoutException('Post service timeout');
              }
              throw error;
            }),
          ),
      );
    } else {
      throw new NotFoundException('Invalid target type');
    }
    return this.mapToDto(snapshot, content);
  }

  private mapToDto(
    snapshot: any,
    content: PostResponseDTO | CommentResponseDTO,
  ): AnalysisSummaryDto {
    return {
      targetId: snapshot.targetId,
      targetType: snapshot.targetType,

      finalEmotion: snapshot.finalEmotion,
      primaryEmotion: snapshot.primaryEmotion || snapshot.finalEmotion,
      secondaryEmotions: snapshot.secondaryEmotions || [],
      finalScores: snapshot.finalScores,
      confidence: snapshot.finalConfidence,

      riskLevel: snapshot.mentalHealthRiskLevel ?? 'none',
      mentalHealthRiskLevel: snapshot.mentalHealthRiskLevel ?? 'none',
      isSarcasmOrConflict: snapshot.isSarcasmOrConflict ?? false,

      createdAt: snapshot.createdAt,
      content,
    };
  }
}
