import { Module } from '@nestjs/common';
import { UserPreferenceService } from './user-preference.service';
import { UserPreferenceController } from './user-preference.controller';
import { ClientProxy } from '@nestjs/microservices';
import { MongoModule } from 'src/mongo/mongo.module';
import { MongooseModule } from '@nestjs/mongoose';
import { UserPreference, UserPreferenceSchema } from 'src/mongo/schema/user-preference.schema';
import { RedisModule } from '@repo/common';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserPreference.name, schema: UserPreferenceSchema}]),
    RedisModule
  ],
  controllers: [UserPreferenceController],
  providers: [UserPreferenceService],
  exports: [UserPreferenceService],
})
export class UserPreferenceModule {}
