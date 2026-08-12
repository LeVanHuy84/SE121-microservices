import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './schema/audit-log.schema';
import {
  UserActivityLog,
  UserActivityLogSchema,
} from './schema/user-activity.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: UserActivityLog.name, schema: UserActivityLogSchema },
    ]),
  ],
  providers: [],
  exports: [MongooseModule],
})
export class LoggingMongoModule {}
