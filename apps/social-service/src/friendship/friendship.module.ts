import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupClientModule } from 'src/client/group/group-client.module';
import { RecommendationClientModule } from 'src/client/recommendation/recommendation-client.module';
import { UserClientModule } from 'src/client/user/user-client.module';
import { FriendshipController } from './friendship.controller';
import { FriendshipService } from './friendship.service';
import { FriendRecommendationEventEntity } from 'src/postgres/entities/friend-recommendation-event.entity';
import { FriendRequestEntity } from 'src/postgres/entities/friend-request.entity';
import { FriendRecommendationDismissalEntity } from 'src/postgres/entities/friend-recommendation-dismissal.entity';
import { FriendshipEntity } from 'src/postgres/entities/friendship.entity';
import { UserBlockEntity } from 'src/postgres/entities/user-block.entity';
import { PostgresSocialGraphRepository } from './repositories/postgres-social-graph.repository';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';
import { CandidateSourceService } from './recommendation/candidate-source.service';
import { RecommendationBaselineRankerService } from './recommendation/recommendation-baseline-ranker.service';
import { RecommendationDiversityService } from './recommendation/recommendation-diversity.service';
import { RecommendationFeatureService } from './recommendation/recommendation-feature.service';
import { RecommendationHydrationService } from './recommendation/recommendation-hydration.service';
import { RecommendationQueryService } from './recommendation/recommendation-query.service';
import { RecommendationSnapshotService } from './recommendation/recommendation-snapshot.service';
import { RecommendationTrackingService } from './recommendation/recommendation-tracking.service';

@Module({
  imports: [
    GroupClientModule,
    RecommendationClientModule,
    UserClientModule,
    TypeOrmModule.forFeature([
      FriendRecommendationEventEntity,
      FriendRequestEntity,
      FriendRecommendationDismissalEntity,
      FriendshipEntity,
      UserBlockEntity,
    ]),
  ],
  controllers: [FriendshipController],
  providers: [
    CandidateSourceService,
    FriendshipService,
    PostgresSocialGraphRepository,
    RecommendationBaselineRankerService,
    RecommendationDiversityService,
    RecommendationFeatureService,
    RecommendationHydrationService,
    RecommendationQueryService,
    RecommendationSnapshotService,
    RecommendationTrackingService,
    {
      provide: SOCIAL_GRAPH_REPOSITORY,
      useExisting: PostgresSocialGraphRepository,
    },
  ],
})
export class FriendshipModule {}
