import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReactionController } from './reaction.controller';
import { CommentController } from './comment.controller';
import { ShareController } from './share.controller';
import { GroupPostController } from './group-post.controller';
import { ReportController } from './report.controller';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.POST_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('POST_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [
    PostController,
    ReactionController,
    CommentController,
    ShareController,
    GroupPostController,
    ReportController,
  ],
})
export class PostModule {}
