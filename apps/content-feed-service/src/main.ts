import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { ExceptionsFilter } from "@repo/common";
import { Kafka } from "kafkajs";
import { EventTopic } from "@repo/dtos";

async function ensureKafkaTopics() {
  const brokers = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
  const kafka = new Kafka({
    clientId: "content-feed-service-admin",
    brokers,
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    const requiredTopics = [
      EventTopic.EMOTION_RESULT,
      EventTopic.INTERACTION,
      EventTopic.POST,
      EventTopic.SHARE,
      EventTopic.STATS,
      EventTopic.TEST_FAULT,
      EventTopic.LOGGING,
      EventTopic.USER_ACTIVITY_LOG,
      EventTopic.MEDIA,
      EventTopic.MODERATION_REJECTED,
    ];
    const topicsToCreate = requiredTopics
      .filter((topic) => !existingTopics.includes(topic))
      .map((topic) => ({ topic }));

    if (topicsToCreate.length > 0) {
      console.log(
        `Auto-creating Kafka topics: ${topicsToCreate.map((t) => t.topic).join(", ")}`,
      );
      await admin.createTopics({
        topics: topicsToCreate,
      });
    }
  } catch (error: any) {
    console.warn(
      "Failed to ensure Kafka topics exist:",
      error.message || error,
    );
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

async function bootstrap() {
  // Ensure required Kafka topics are created to avoid connection exceptions
  await ensureKafkaTopics();

  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new ExceptionsFilter());

  // 1) TCP Microservice for API Gateway communication
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      port: parseInt(process.env.PORT || "4002", 10),
    },
  });

  // 2) Redis Microservice if needed by post controllers
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.REDIS,
    options: {
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      host: process.env.REDIS_HOST || "localhost",
    },
  });

  // 3) RabbitMQ Microservice for Realtime Notifications Queue
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [
        `amqp://${process.env.RABBITMQ_USER || "guest"}:${process.env.RABBITMQ_PASS || "guest"}` +
          `@${process.env.RABBITMQ_HOST || "localhost"}:${process.env.RABBITMQ_PORT || "5672"}`,
      ],
      queue: process.env.RABBITMQ_QUEUE || "create_notification_queue",
      queueOptions: {
        durable: true,
      },
      noAck: false,
    },
  });

  // 4) Kafka Microservice for cross-domain Async Event Patterns
  const kafkaFromBeginning = process.env.KAFKA_FROM_BEGINNING === "true";
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
        clientId: process.env.KAFKA_CLIENT_ID || "content-feed-service",
      },
      consumer: {
        groupId: process.env.KAFKA_GROUP_ID || "content-feed-service-group",
        sessionTimeout: 10000,
        heartbeatInterval: 3000,
      },
      subscribe: {
        fromBeginning: kafkaFromBeginning,
      },
      run: {
        autoCommit: false,
        eachBatchAutoResolve: false,
      },
      commitAfterFunctionCompleted: false,
    },
  });

  // Start all connected microservices
  await app.startAllMicroservices();

  // Listen HTTP on 4200 (Media upload gateway target)
  const httpPort = parseInt(process.env.HTTP_PORT || "4200", 10);
  await app.listen(httpPort);

  console.log(`[Content Feed Service] Hybrid Application Started.`);
  console.log(` - HTTP API listening on port ${httpPort}`);
  console.log(
    ` - TCP Microservice listening on port ${process.env.PORT || "4002"}`,
  );
}

bootstrap();
