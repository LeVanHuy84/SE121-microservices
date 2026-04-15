import { Module } from '@nestjs/common';
import { KafkaConsumerController } from './kafka-consumer.controller';
import { PostModule } from '../post/post.module';
import { GroupModule } from '../group/group.module';
import { UserModule } from '../user/user.module';
import { PostConsumerService } from './service/post-consumer.service';
import { GroupConsumerService } from './service/group-consumer.service';
import { UserConsumerService } from './service/user-consumer.service';
import {
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from '@repo/common';

@Module({
  imports: [
    PostModule,
    GroupModule,
    UserModule,
    KafkaProducerModule.registerAsync(),
  ],
  controllers: [KafkaConsumerController],
  providers: [
    PostConsumerService,
    GroupConsumerService,
    UserConsumerService,
    KafkaDLQService,
    KafkaConsumerHelper,
  ],
})
export class KafkaConsumerModule {}
