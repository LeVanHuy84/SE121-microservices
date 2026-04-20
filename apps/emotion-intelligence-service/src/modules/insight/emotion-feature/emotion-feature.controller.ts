import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { EmotionFeatureService } from './emotion-feature.service';
import {
  EmotionRankingFeaturesDto,
  GetEmotionRankingFeaturesInputDto,
  UserEmotionSignalDto,
} from '@repo/dtos';

// TODO: align this pattern with caller contract in API Gateway/feed-service if a different command name is already in use.
const GET_EMOTION_RANKING_FEATURES_PATTERN = 'get_emotion_ranking_features';
const GET_USER_EMOTION_SIGNAL_PATTERN = 'get_user_emotion_signal';

@Controller()
export class EmotionFeatureController {
  constructor(private readonly emotionFeatureService: EmotionFeatureService) {}

  @MessagePattern(GET_EMOTION_RANKING_FEATURES_PATTERN)
  async getEmotionRankingFeatures(
    @Payload() payload: GetEmotionRankingFeaturesInputDto,
  ): Promise<EmotionRankingFeaturesDto> {
    return this.emotionFeatureService.getUserEmotionFeatures(payload.userId);
  }

  @MessagePattern(GET_USER_EMOTION_SIGNAL_PATTERN)
  async getUserEmotionSignal(
    @Payload() payload: { userId: string },
  ): Promise<UserEmotionSignalDto> {
    return this.emotionFeatureService.getUserEmotionSignal(payload.userId);
  }
}
