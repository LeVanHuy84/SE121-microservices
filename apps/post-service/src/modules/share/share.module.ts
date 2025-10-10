import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from 'src/entities/share.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { KafkaModule } from '../kafka/kafka.module';
import { ShareCommandService } from './share-command.service';
import { ShareQueryService } from './share-query.service';
import { OutboxEvent } from 'src/entities/outbox.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Share, ShareStat, OutboxEvent])],
  controllers: [ShareController],
  providers: [ShareCommandService, ShareQueryService],
})
export class ShareModule {}
