import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from 'src/entities/share.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { ShareEventPublisher } from './share-event.service';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [TypeOrmModule.forFeature([Share, ShareStat]), KafkaModule],
  controllers: [ShareController],
  providers: [ShareService, ShareEventPublisher],
})
export class ShareModule {}
