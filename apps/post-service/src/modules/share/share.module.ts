import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from 'src/entities/share.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { ShareCommandService } from './service/share-command.service';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { ShareQueryService } from './service/share-query.service';
import { ShareCacheService } from './service/share-cache.service';
import { SocialClientModule } from '../client/social/social-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Share, ShareStat, Reaction, OutboxEvent]),
    SocialClientModule,
  ],
  controllers: [ShareController],
  providers: [ShareCommandService, ShareQueryService, ShareCacheService],
})
export class ShareModule {}
