import { initOTel } from '@repo/common';
initOTel('search-recommendation-service');

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';
import { Kafka } from 'kafkajs';
import { EventTopic } from '@repo/dtos';

async function ensureKafkaTopics() {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({
    clientId: 'search-recommendation-service-admin',
    brokers,
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    const requiredTopics = [
      EventTopic.POST,
      EventTopic.GROUP_CRUD,
      EventTopic.USER,
      EventTopic.EMOTION_RESULT,
      EventTopic.RECOMMENDATION_PROFILE,
      EventTopic.RECOMMENDATION_GRAPH,
      'recommendation-emotion-events',
    ];
    const topicsToCreate = requiredTopics
      .filter((topic) => !existingTopics.includes(topic))
      .map((topic) => ({ topic }));

    if (topicsToCreate.length > 0) {
      console.log(
        `[SearchRecommendationService] Auto-creating Kafka topics: ${topicsToCreate.map((t) => t.topic).join(', ')}`,
      );
      await admin.createTopics({
        topics: topicsToCreate,
      });
    }
  } catch (error: any) {
    console.warn(
      '[SearchRecommendationService] Failed to ensure Kafka topics exist:',
      error.message || error,
    );
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

async function bootstrap() {
  // Đảm bảo các topic cần thiết tồn tại trên Kafka trước khi connect
  await ensureKafkaTopics();

  // Tạo Hybrid Application để AppModule và các kết nối chỉ khởi tạo 1 lần duy nhất
  const app = await NestFactory.create(AppModule);

  // Đăng ký TCP Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: process.env.PORT ? parseInt(process.env.PORT) : 4003,
    },
  });

  // Đăng ký Kafka Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: process.env.KAFKA_BROKERS
          ? process.env.KAFKA_BROKERS.split(',')
          : ['localhost:9092'],
        clientId:
          process.env.KAFKA_CLIENT_ID || 'search-recommendation-service',
      },
      consumer: {
        groupId: process.env.KAFKA_SEARCH_ID || 'search-recommendation-group',
      },
      subscribe: {
        fromBeginning: true,
      },
    },
  });

  app.useGlobalFilters(new ExceptionsFilter());

  // Khởi chạy tất cả microservices
  await app.startAllMicroservices();
  await app.init();
}
bootstrap();
