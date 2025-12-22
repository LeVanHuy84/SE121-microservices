import { Module } from '@nestjs/common';
import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from 'src/mongo/schema/audit-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [ConsumerController],
  providers: [ConsumerService],
  exports: [],
})
export class ConsumerModule {}
