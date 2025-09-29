import { Module } from '@nestjs/common';
import { ReactionController } from './react.controller';
import { ReactionService } from './react.service';
import { Reaction } from 'src/entities/reaction.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Reaction])],
  controllers: [ReactionController],
  providers: [ReactionService],
})
export class ReactModule {}
