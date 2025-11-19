import { Module } from '@nestjs/common';
import { KafkaConsumerController } from './kafka-consumer.controller';
import { KafkaConsumerService } from './kafka-consumer.service';
import { PostModule } from '../post/post.module';
import { GroupModule } from '../group/group.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [PostModule, GroupModule, UserModule],
  controllers: [KafkaConsumerController],
  providers: [KafkaConsumerService],
})
export class KafkaConsumerModule {}
