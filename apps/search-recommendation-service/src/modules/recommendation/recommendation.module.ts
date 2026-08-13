import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileEmbedding } from './entities/profile-embedding.entity';
import { RecommendationFriendship } from './entities/recommendation-friendship.entity';
import { RecommendationPendingRequest } from './entities/recommendation-pending-request.entity';
import { RecommendationBlock } from './entities/recommendation-block.entity';
import { RecommendationDismissal } from './entities/recommendation-dismissal.entity';
import { RecommendationGraphEventJournal } from './entities/recommendation-graph-event-journal.entity';
import { RecommendationPairFeature } from './entities/recommendation-pair-feature.entity';
import { RecommendationGlobalFallbackCandidate } from './entities/recommendation-global-fallback-candidate.entity';
import { RecommendationEmotionProfile } from './entities/recommendation-emotion-profile.entity';
import { RecommendationController } from './recommendation.controller';
import { QueryService } from './services/query.service';
import { QueryCacheService } from './services/query-cache.service';
import { CandidateRetrievalService } from './services/candidate-retrieval.service';
import { GlobalFallbackService } from './services/global-fallback.service';
import { RankingService } from './services/ranking.service';
import { EmbeddingService } from './services/embedding.service';
import { RecommendationStateRepository } from './services/recommendation-state.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProfileEmbedding,
      RecommendationFriendship,
      RecommendationPendingRequest,
      RecommendationBlock,
      RecommendationDismissal,
      RecommendationGraphEventJournal,
      RecommendationPairFeature,
      RecommendationGlobalFallbackCandidate,
      RecommendationEmotionProfile,
    ]),
  ],
  controllers: [RecommendationController],
  providers: [
    RecommendationStateRepository,
    EmbeddingService,
    QueryCacheService,
    CandidateRetrievalService,
    GlobalFallbackService,
    RankingService,
    QueryService,
  ],
  exports: [RecommendationStateRepository, EmbeddingService, QueryCacheService],
})
export class RecommendationModule {}
