<<<<<<< HEAD
import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReactionController } from './reaction.controller';
import { CommentController } from './comment.controller';
import { ShareController } from './share.controller';
=======
import { Module } from "@nestjs/common";
import { PostController } from "./post.controller";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ReactionController } from "./reaction.controller";
import { CommentController } from "./comment.controller";
>>>>>>> 98ddb9e3e89a36ff48637f22dc472df9c343424d

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
<<<<<<< HEAD
            port: config.get<number>('POST_SERVICE_PORT'),
=======
            port: config.get<number>("POST_SERVICE_PORT"),
>>>>>>> 98ddb9e3e89a36ff48637f22dc472df9c343424d
          },
        }),
      },
    ]),
  ],
<<<<<<< HEAD
  controllers: [
    PostController,
    ReactionController,
    CommentController,
    ShareController,
  ],
=======
  controllers: [PostController, ReactionController, CommentController],
>>>>>>> 98ddb9e3e89a36ff48637f22dc472df9c343424d
})
export class PostModule {}
