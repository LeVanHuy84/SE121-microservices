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
import { RecommendationQueryService } from './recommendation/recommendation-query.service';

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
    FriendshipService,
    PostgresSocialGraphRepository,
    RecommendationQueryService,
    {
      provide: SOCIAL_GRAPH_REPOSITORY,
      useExisting: PostgresSocialGraphRepository,
    },
  ],
})
export class FriendshipModule {}
