import { Module } from '@nestjs/common';
import { KafkaConsumerController } from './kafka-consumer.controller';
import { PostModule } from '../post/post.module';
import { GroupModule } from '../group/group.module';
import { UserModule } from '../user/user.module';
import { PostConsumerService } from './service/post-consumer.service';
import { GroupConsumerService } from './service/group-consumer.service';
import { UserConsumerService } from './service/user-consumer.service';

@Module({
  imports: [PostModule, GroupModule, UserModule],
  controllers: [KafkaConsumerController],
  providers: [PostConsumerService, GroupConsumerService, UserConsumerService],
})
export class KafkaConsumerModule {}
