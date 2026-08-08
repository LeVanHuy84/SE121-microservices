import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupRecommendationService } from './group-recommendation.service';
import { GroupRecommendationController } from './group-recommendation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GroupMember])],
  controllers: [GroupRecommendationController],
  providers: [GroupRecommendationService],
  exports: [GroupRecommendationService],
})
export class GroupRecommendationModule {}
