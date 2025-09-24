import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostModule } from './modules/post/post.module';
import { ReactModule } from './modules/reaction/react.module';
import { CommentModule } from './modules/comment/comment.module';
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
    PostModule,
    ReactModule,
    CommentModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
