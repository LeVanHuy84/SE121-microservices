import { Module } from '@nestjs/common';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { KafkaConsumerController } from './kafka-consumer.controller';
import { MediaConsumerService } from './media-consumer.service';


@Module({
  imports: [CloudinaryModule],
  controllers: [KafkaConsumerController],
  providers: [MediaConsumerService],
})
export class KafkaConsumerModule {}
