import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from 'src/entities/comment.entity';
import { ContentModeration } from 'src/entities/content-moderation.entity';
import { Post } from 'src/entities/post.entity';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ModerationAppealService } from './appeal.service';
import { Share } from 'src/entities/share.entity';
import { ModerationAppeal } from 'src/entities/moderation-appeal.entity';
import { UserClientModule } from '../client/user/user-client.module';
import { LogService } from './log.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Post,
      Comment,
      Share,
      ContentModeration,
      ModerationAppeal,
    ]),
    UserClientModule,
  ],
  controllers: [ModerationController],
  providers: [
    ModerationService,
    ModerationAppealService,
    ModerationAppealService,
    LogService,
  ],
  exports: [],
})
export class ModerationModule {}
