import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  EventDestination,
  EventTopic,
  GroupEventType,
  InferGroupPayload,
} from "@repo/dtos";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import type { DrizzleDB } from "src/drizzle/types/drizzle.d";
import { outboxEvents } from "src/drizzle/schema/schema";
import { GroupBufferService } from "./group-buffer.service";

@Injectable()
export class GroupBatchService {
  private readonly logger = new Logger(GroupBatchService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly buffer: GroupBufferService,
  ) {}

  @Cron("0 */10 * * * *") // chạy mỗi 10 phút
  async handleMemberCountBatch() {
    this.logger.log("🔃 MemberCountBatch: scanning buffer...");

    const all = await this.buffer.getAll();
    const groupIds = Object.keys(all);

    if (groupIds.length === 0) {
      this.logger.log("No member count changes found.");
      return;
    }

    this.logger.log(`Found ${groupIds.length} groups with updates.`);

    await this.db.transaction(async (tx) => {
      const outboxRecords = groupIds.map((groupId) => {
        const memberCount = all[groupId];
        const payload: InferGroupPayload<GroupEventType.UPDATED> = {
          groupId,
          members: memberCount,
        };
        return {
          destination: EventDestination.KAFKA,
          topic: EventTopic.GROUP_CRUD,
          eventType: GroupEventType.UPDATED,
          payload,
        };
      });

      await tx.insert(outboxEvents).values(outboxRecords);

      for (const id of groupIds) {
        await this.buffer.clear(id);
      }
    });

    this.logger.log(`Member count batch flushed (${groupIds.length} events).`);
  }
}
