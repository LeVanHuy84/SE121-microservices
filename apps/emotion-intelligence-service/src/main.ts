import { initOTel } from '@repo/common';
initOTel('emotion-intelligence-service');

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';
import { Kafka } from 'kafkajs';
import { EventTopic } from '@repo/dtos';
import { AppModule } from './app.module';

async function ensureKafkaTopics() {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({
    clientId: 'emotion-intelligence-service-admin',
    brokers,
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    const requiredTopics = [
      EventTopic.EMOTION_RESULT,
      EventTopic.MODERATION_REJECTED,
      EventTopic.PROACTIVE_INTERVENTION,
    ];
    const topicsToCreate = requiredTopics
      .filter((topic) => !existingTopics.includes(topic))
      .map((topic) => ({ topic }));

    if (topicsToCreate.length > 0) {
      console.log(
        `[EmotionIntelligenceService] Auto-creating Kafka topics: ${topicsToCreate.map((t) => t.topic).join(', ')}`,
      );
      await admin.createTopics({
        topics: topicsToCreate,
      });
    }
  } catch (error: any) {
    console.warn(
      '[EmotionIntelligenceService] Failed to ensure Kafka topics exist:',
      error.message || error,
    );
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

async function bootstrap() {
  await ensureKafkaTopics();

  // Hybrid Application pattern
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new ExceptionsFilter());

  // 1) TCP Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4005,
    },
  });

  // 2) Kafka Microservice
  const kafkaFromBeginning = process.env.KAFKA_FROM_BEGINNING === 'true';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
        clientId:
          process.env.KAFKA_CLIENT_ID || 'emotion-intelligence-service',
      },
      consumer: {
        groupId:
          process.env.KAFKA_GROUP_ID || 'emotion-intelligence-service-group',
      },
      subscribe: {
        fromBeginning: kafkaFromBeginning,
      },
    },
  });

  await app.startAllMicroservices();
  await app.init();

  console.log(`[Emotion Intelligence Service] Hybrid Application Started.`);
  console.log(
    ` - TCP Microservice listening on port ${process.env.PORT || '4005'}`,
  );
}
void bootstrap();
