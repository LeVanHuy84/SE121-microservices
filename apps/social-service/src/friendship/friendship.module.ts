import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupClientModule } from 'src/client/group/group-client.module';
import { FriendshipController } from './friendship.controller';
import { FriendRecommendationService } from './friend-recommendation.service';
import { FriendshipService } from './friendship.service';
import { FriendRequestEntity } from 'src/postgres/entities/friend-request.entity';
import { FriendshipEntity } from 'src/postgres/entities/friendship.entity';
import { UserBlockEntity } from 'src/postgres/entities/user-block.entity';
import { PostgresSocialGraphRepository } from './repositories/postgres-social-graph.repository';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';

@Module({
  imports: [
    GroupClientModule,
    TypeOrmModule.forFeature([
      FriendRequestEntity,
      FriendshipEntity,
      UserBlockEntity,
    ]),
  ],
  controllers: [FriendshipController],
  providers: [
    FriendRecommendationService,
    FriendshipService,
    PostgresSocialGraphRepository,
    {
      provide: SOCIAL_GRAPH_REPOSITORY,
      useExisting: PostgresSocialGraphRepository,
    },
  ],
})
export class FriendshipModule {}
