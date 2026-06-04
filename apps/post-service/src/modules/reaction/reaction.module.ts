import { Module } from '@nestjs/common';
import { ReactionController } from './reaction.controller';
import { ReactionService } from './reaction.service';
import { Reaction } from 'src/entities/reaction.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserClientModule } from '../client/user/user-client.module';
import { StatsModule } from '../stats/stats.module';
import { EventModule } from '../event/event.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reaction]),
    UserClientModule,
    StatsModule,
    EventModule,
  ],
  controllers: [ReactionController],
  providers: [ReactionService],
})
export class ReactionModule {}
