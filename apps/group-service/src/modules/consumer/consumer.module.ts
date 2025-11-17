import { Module } from '@nestjs/common';
import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { GroupLogModule } from '../group-log/group-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GroupMember, OutboxEvent]),
    GroupLogModule,
  ],
  controllers: [ConsumerController],
  providers: [ConsumerService],
  exports: [],
})
export class ConsumerModule {}
