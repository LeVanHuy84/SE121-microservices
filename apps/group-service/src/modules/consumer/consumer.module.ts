import { Module } from '@nestjs/common';
import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { GroupLog } from 'src/entities/group-log.entity';
import { GroupLogService } from '../group-log/group-log.service';
import {
  IdempotencyModule,
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from '@repo/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([GroupMember, OutboxEvent, GroupLog]),
    IdempotencyModule.forPostgres(),
    KafkaProducerModule.registerAsync(),
  ],
  controllers: [ConsumerController],
  providers: [
    ConsumerService,
    GroupLogService,
    KafkaDLQService,
    KafkaConsumerHelper,
  ],
  exports: [],
})
export class ConsumerModule {}
