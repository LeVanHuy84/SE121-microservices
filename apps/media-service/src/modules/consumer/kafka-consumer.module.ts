import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { Media } from 'src/entities/media.entity';
import { KafkaConsumerController } from './kafka-consumer.controller';
import { MediaConsumerService } from './media-consumer.service';


@Module({
  imports: [CloudinaryModule, TypeOrmModule.forFeature([Media])],
  controllers: [KafkaConsumerController],
  providers: [MediaConsumerService],
})
export class KafkaConsumerModule {}
