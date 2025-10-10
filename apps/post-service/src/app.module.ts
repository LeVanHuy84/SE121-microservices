import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostModule } from './modules/post/post.module';
import { ReactionModule } from './modules/reaction/reaction.module';
import { CommentModule } from './modules/comment/comment.module';
import { ShareModule } from './modules/share/share.module';
import dbConfig from './config/db.config';
import { Kafka } from 'kafkajs';
import { KafkaModule } from './modules/kafka/kafka.module';

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
    PostModule,
    ReactionModule,
    CommentModule,
    ShareModule,
    KafkaModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
