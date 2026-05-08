import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config'; // Import ConfigModule and ConfigService
import { AuditLog, AuditLogSchema } from './schema/audit-log.schema';
import {
  UserActivity,
  UserActivitySchema,
} from './schema/user-activity.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        dbName: 'logging_service',
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: UserActivity.name, schema: UserActivitySchema },
    ]),
  ],
  providers: [],
  exports: [MongooseModule],
})
export class MongoModule {}
