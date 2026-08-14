import { Controller, Logger } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import * as dtos from "@repo/dtos";
import { IngestionPostService } from "./service/ingestion-post.service";
import { IngestionShareService } from "./service/ingestion-share.service";
import { StatsIngestionService } from "./service/ingestion-stats.service";
import { KafkaConsumerHelper } from "@repo/common";
import { Ctx, KafkaContext } from "@nestjs/microservices";
import { ClientSession } from "mongoose";

@Controller("ingestion")
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(
    private readonly ingestionPost: IngestionPostService,
    private readonly ingestionShare: IngestionShareService,
    private readonly ingestionStats: StatsIngestionService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}

  // ----------------------------
  // POST TOPIC HANDLER
  // ----------------------------
  @EventPattern(dtos.EventTopic.POST)
  async handlePostEvents(
    @Payload() message: dtos.PostEventMessage,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();

    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handle({
      topic,
      eventId,
      message,
      context,
      handler: async (session: ClientSession) => {
        const { type, payload } = message;

        switch (type) {
          case dtos.PostEventType.CREATED:
            this.logger.log(`Post created: ${payload.postId}`);
            await this.ingestionPost.handleCreated(payload, session);
            break;

          case dtos.PostEventType.UPDATED:
            await this.ingestionPost.handleUpdated(payload, session);
            break;

          case dtos.PostEventType.REMOVED:
            await this.ingestionPost.handleRemoved(payload, session);
            break;
        }
      },
    });
  }

  // ----------------------------
  // SHARE TOPIC HANDLER
  // ----------------------------
  @EventPattern(dtos.EventTopic.SHARE)
  async handleShareEvents(
    @Payload() message: dtos.ShareEventMessage,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();

    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handle({
      topic,
      eventId,
      message,
      context,
      handler: async (session: ClientSession) => {
        const { type, payload } = message;

        switch (type) {
          case dtos.ShareEventType.CREATED:
            await this.ingestionShare.handleCreated(payload, session);
            break;

          case dtos.ShareEventType.UPDATED:
            await this.ingestionShare.handleUpdated(payload, session);
            break;

          case dtos.ShareEventType.REMOVED:
            await this.ingestionShare.handleRemoved(payload, session);
            break;
        }
      },
    });
  }

  // ----------------------------
  // STATS TOPIC HANDLER
  // ----------------------------
  @EventPattern(dtos.EventTopic.STATS)
  async handleStatsEvents(
    @Payload() message: dtos.StatsEvent,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();

    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handle({
      topic,
      eventId,
      message,
      context,
      handler: async (session: ClientSession) => {
        await this.ingestionStats.processStatsBatch(message.payload, session);
      },
    });
  }

  @EventPattern(dtos.EventTopic.TEST_FAULT)
  async handleTestFault(
    @Payload() message: dtos.TestEventMessage,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const raw = context.getMessage();

    const eventId =
      message.eventId ||
      raw.key?.toString() ||
      `${topic}-${context.getPartition()}-${raw.offset}`;

    await this.consumerHelper.handle({
      topic,
      eventId,
      message,
      context,
      metadata: {
        crashAfterCommit: message.type === dtos.TestEventType.CRASH_AFTER,
      },
      handler: async (_session: ClientSession) => {
        this.logger.log(`🧪 Running test case: ${message.type}`);

        switch (message.type) {
          case dtos.TestEventType.CRASH_BEFORE:
            console.log("CASE 1: Crash BEFORE transaction");
            // process.exit(1);
            console.log("Resuming processing after simulated crash...");
            break;

          case dtos.TestEventType.CRASH_DURING:
            console.log("Processing...");
            await new Promise((res) => setTimeout(res, 500));

            console.log("CASE 2:Crash DURING transaction");
            // process.exit(1);
            break;

          case dtos.TestEventType.FAIL:
            console.log("CASE 4: Simulate failure");
            throw new Error("Simulated failure for retry + DLQ");

          default:
            console.log("Normal processing");
        }
      },
    });
  }
}
