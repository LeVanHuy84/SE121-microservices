import { initOTel } from "@repo/common";
initOTel("user-social-service");

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { ExceptionsFilter } from "@repo/common";
import { CommandService } from "./modules/user/command/command.service";
import { Kafka } from "kafkajs";
import { EventTopic } from "@repo/dtos";

async function ensureKafkaTopics() {
  const brokers = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
  const kafka = new Kafka({
    clientId: "user-service-admin",
    brokers,
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    const requiredTopics = [
      EventTopic.GROUP,
      EventTopic.POST,
      EventTopic.RECOMMENDATION_GRAPH,
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
  await ensureKafkaTopics();

  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: "0.0.0.0",
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4001,
    },
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
        clientId: process.env.KAFKA_CLIENT_ID || "user-service",
        retry: { retries: 3 },
      },
      consumer: {
        groupId: process.env.KAFKA_GROUP_ID || "user-service-group",
        allowAutoTopicCreation: true,
      },
      subscribe: { fromBeginning: false },
    },
  });

  app.useGlobalFilters(new ExceptionsFilter());

  await app.startAllMicroservices();
  await app.init();

  const commandService = app.get(CommandService);
  await commandService.run();

  console.log(
    `User social service is running (TCP port: ${process.env.PORT || "4001"})`,
  );
}
bootstrap();
