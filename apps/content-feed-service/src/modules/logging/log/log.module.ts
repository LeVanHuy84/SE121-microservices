import { Module } from "@nestjs/common";
import { LogController } from "./log.controller";
import { LogService } from "./log.service";
import { MongooseModule } from "@nestjs/mongoose";
import { AuditLog, AuditLogSchema } from "../mongo/schema/audit-log.schema";
import {
  UserActivityLog,
  UserActivityLogSchema,
} from "../mongo/schema/user-activity.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: UserActivityLog.name, schema: UserActivityLogSchema },
    ]),
  ],
  controllers: [LogController],
  providers: [LogService],
})
export class LogModule {}
