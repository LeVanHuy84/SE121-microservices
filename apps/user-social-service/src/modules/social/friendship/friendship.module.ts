import { Module } from '@nestjs/common';
import { RecommendationClientModule } from 'src/modules/social/services/recommendation-client.module';
import { UserClientModule } from 'src/modules/social/services/user-client.module';
import { FriendshipController } from './friendship.controller';
import { FriendshipService } from './friendship.service';
import { PostgresSocialGraphRepository } from './repositories/postgres-social-graph.repository';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';
import { RecommendationQueryService } from './recommendation/recommendation-query.service';
import { DrizzleModule } from 'src/drizzle/drizzle.module';

@Module({
  imports: [
    RecommendationClientModule,
    UserClientModule,
    DrizzleModule,
  ],
  controllers: [FriendshipController],
  providers: [
    FriendshipService,
    PostgresSocialGraphRepository,
    RecommendationQueryService,
    {
      provide: SOCIAL_GRAPH_REPOSITORY,
      useExisting: PostgresSocialGraphRepository,
    },
  ],
  exports: [FriendshipService],
})
export class FriendshipModule {}
