import { Module } from '@nestjs/common';
import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { GroupLog } from 'src/entities/group-log.entity';
import { GroupLogService } from '../group-log/group-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([GroupMember, OutboxEvent, GroupLog])],
  controllers: [ConsumerController],
  providers: [ConsumerService, GroupLogService],
  exports: [],
})
export class ConsumerModule {}
