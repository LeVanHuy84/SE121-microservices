import { initOTel } from "@repo/common";
initOTel("user-social-service");

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { ExceptionsFilter } from "@repo/common";
import { CommandService } from "./modules/user/command/command.service";
import { CommandModule } from "./modules/user/command/command.module";
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

  const tcpApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4001,
      },
    },
  );

  const kafkaApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
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
    },
  );

  tcpApp.useGlobalFilters(new ExceptionsFilter());
  kafkaApp.useGlobalFilters(new ExceptionsFilter());

  // Start TCP (always required)
  await tcpApp.listen();
  console.log("User service TCP transport started.");

  // Start Kafka consumer independently — don't crash if Kafka unavailable
  kafkaApp.listen().catch((err) => {
    console.warn("[Kafka] Consumer failed to start:", err?.message ?? err);
  });

  // Use a dedicated module for startup commands so closing this context
  // does not tear down shared infra providers from AppModule (e.g. Redis).
  const commandApp = await NestFactory.createApplicationContext(CommandModule);
  const commandService = commandApp.get(CommandService);
  await commandService.run();
  await commandApp.close();

  console.log("User service is running on port 4001");
}
bootstrap();
