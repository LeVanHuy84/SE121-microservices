import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { MediaModule } from './modules/media/media.module';
import { KafkaConsumerModule } from './modules/consumer/kafka-consumer.module';
import dbConfig from './config/db.config';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      load: [dbConfig],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: dbConfig,
    }),
    ScheduleModule.forRoot(),
    MediaModule,
    KafkaConsumerModule,
  ],
})
export class AppModule {}
