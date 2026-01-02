import { Module } from '@nestjs/common';
import { ConsumerModule } from './modules/consumer/consumer.module';
import { MongoModule } from './mongo/mongo.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    MongoModule,
    ConsumerModule,
  ],
})
export class KafkaAppModule {}
