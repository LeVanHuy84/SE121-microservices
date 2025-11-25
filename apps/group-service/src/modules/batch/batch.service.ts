import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

import { OutboxEvent } from 'src/entities/outbox.entity';
import { GroupBufferService } from './buffer.service';
import {
  EventDestination,
  EventTopic,
  GroupEventType,
  InferGroupPayload,
} from '@repo/dtos';

@Injectable()
export class GroupBatchService {
  private readonly logger = new Logger(GroupBatchService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly buffer: GroupBufferService,
  ) {}

  @Cron('0 */10 * * * *') // chạy mỗi 10 phút
  async handleMemberCountBatch() {
    this.logger.log('🔃 MemberCountBatch: scanning buffer...');

    const all = await this.buffer.getAll();
    const groupIds = Object.keys(all);

    if (groupIds.length === 0) {
      this.logger.log('No member count changes found.');
      return;
    }

    this.logger.log(`Found ${groupIds.length} groups with updates.`);

    await this.dataSource.transaction(async (manager) => {
      const outboxRecords: OutboxEvent[] = groupIds.map((groupId) => {
        const memberCount = all[groupId];

        const payload: InferGroupPayload<GroupEventType.UPDATED> = {
          groupId,
          members: memberCount,
        };

        return manager.create(OutboxEvent, {
          destination: EventDestination.KAFKA,
          topic: EventTopic.GROUP_CRUD,
          eventType: GroupEventType.UPDATED,
          payload,
        });
      });

      await manager.save(outboxRecords);

      // clear hết buffer song song
      for (const id of groupIds) {
        await this.buffer.clear(id);
      }
    });

    this.logger.log(`Member count batch flushed (${groupIds.length} events).`);
  }
}
