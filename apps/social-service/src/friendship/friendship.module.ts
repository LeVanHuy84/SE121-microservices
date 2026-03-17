import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FriendshipController } from './friendship.controller';
import { FriendshipService } from './friendship.service';
import { FriendRequestEntity } from 'src/postgres/entities/friend-request.entity';
import { FriendshipEntity } from 'src/postgres/entities/friendship.entity';
import { UserBlockEntity } from 'src/postgres/entities/user-block.entity';
import { PostgresSocialGraphRepository } from './repositories/postgres-social-graph.repository';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FriendRequestEntity,
      FriendshipEntity,
      UserBlockEntity,
    ]),
  ],
  controllers: [FriendshipController],
  providers: [
    FriendshipService,
    PostgresSocialGraphRepository,
    {
      provide: SOCIAL_GRAPH_REPOSITORY,
      useExisting: PostgresSocialGraphRepository,
    },
  ],
})
export class FriendshipModule {}
