import { Module } from '@nestjs/common';
import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from 'src/mongo/schema/audit-log.schema';
import {
  IdempotencyModule,
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from '@repo/common';
import {
  UserActivityLog,
  UserActivityLogSchema,
} from 'src/mongo/schema/user-activity.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: UserActivityLog.name, schema: UserActivityLogSchema },
    ]),

    IdempotencyModule.forMongo(),
    KafkaProducerModule.registerAsync(), // để dùng DLQ
  ],
  controllers: [ConsumerController],
  providers: [ConsumerService, KafkaDLQService, KafkaConsumerHelper],
  exports: [],
})
export class ConsumerModule {}
