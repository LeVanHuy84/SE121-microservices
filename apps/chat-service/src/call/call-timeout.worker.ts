import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CallService } from './call.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CallSessionStatus } from '@repo/dtos';
import {
  CallSession,
  CallSessionDocument,
} from 'src/mongo/schema/call-session.schema';

@Injectable()
export class CallTimeoutWorker {
  private readonly logger = new Logger(CallTimeoutWorker.name);
  private readonly batchSize = Number(
    process.env.CALL_TIMEOUT_BATCH_SIZE ?? 100,
  );
  private readonly rehydrateBatchSize = Number(
    process.env.CALL_TIMEOUT_REHYDRATE_BATCH_SIZE ?? 500,
  );
  private readonly startupGraceMs = Number(
    process.env.CALL_TIMEOUT_REHYDRATE_GRACE_MS ?? 60_000,
  );

  constructor(
    @InjectModel(CallSession.name)
    private readonly callSessionModel: Model<CallSessionDocument>,
    private readonly callService: CallService,
  ) {}

  async onModuleInit() {
    await this.rehydrateTimeoutSchedulesFromMongo();
  }

  @Cron(CronExpression.EVERY_SECOND)
  async processTimeouts() {
    const expired = await this.callService.popDueRingTimeoutCallIds(
      this.batchSize,
    );

    if (expired.length) {
      this.logger.debug(`Found ${expired.length} expired ringing calls`);
      for (const callId of expired) {
        await this.callService.markMissedCallBySystem(callId);
      }
    }

    const reconnectExpired =
      await this.callService.popDueReconnectTimeoutCallIds(this.batchSize);

    if (reconnectExpired.length) {
      this.logger.debug(
        `Found ${reconnectExpired.length} reconnect-timeout accepted calls`,
      );
      for (const callId of reconnectExpired) {
        await this.callService.markReconnectTimeoutCallBySystem(callId);
      }
    }

    const emptyRoomExpired =
      await this.callService.popDueEmptyRoomTimeoutCallIds(this.batchSize);
    if (emptyRoomExpired.length) {
      this.logger.debug(
        `Found ${emptyRoomExpired.length} empty-room-timeout calls`,
      );
      for (const callId of emptyRoomExpired) {
        await this.callService.markEmptyRoomTimeoutCallBySystem(callId);
      }
    }
  }

  private async rehydrateTimeoutSchedulesFromMongo() {
    const threshold = new Date(Date.now() - this.startupGraceMs);
    let ringOffset = 0;
    let reconnectOffset = 0;
    let emptyRoomOffset = 0;
    let ringCount = 0;
    let reconnectCount = 0;
    let emptyRoomCount = 0;

    while (true) {
      const ringingCalls = await this.callSessionModel
        .find(
          {
            status: CallSessionStatus.RINGING,
            ringTimeoutAt: { $ne: null, $gte: threshold },
          },
          { _id: 1, ringTimeoutAt: 1 },
        )
        .sort({ _id: 1 })
        .skip(ringOffset)
        .limit(this.rehydrateBatchSize)
        .lean()
        .exec();

      if (!ringingCalls.length) break;

      await this.callService.scheduleRingTimeoutBulk(
        ringingCalls
          .filter((item) => !!item.ringTimeoutAt)
          .map((item) => ({
            callId: item._id.toString(),
            deadline: item.ringTimeoutAt as Date,
          })),
      );

      ringCount += ringingCalls.length;
      ringOffset += ringingCalls.length;
    }

    while (true) {
      const acceptedCalls = await this.callSessionModel
        .find(
          {
            status: CallSessionStatus.ACCEPTED,
            reconnectDeadlineAt: { $ne: null, $gte: threshold },
          },
          { _id: 1, reconnectDeadlineAt: 1 },
        )
        .sort({ _id: 1 })
        .skip(reconnectOffset)
        .limit(this.rehydrateBatchSize)
        .lean()
        .exec();

      if (!acceptedCalls.length) break;

      await this.callService.scheduleReconnectTimeoutBulk(
        acceptedCalls
          .filter((item) => !!item.reconnectDeadlineAt)
          .map((item) => ({
            callId: item._id.toString(),
            deadline: item.reconnectDeadlineAt as Date,
          })),
      );

      reconnectCount += acceptedCalls.length;
      reconnectOffset += acceptedCalls.length;
    }

    while (true) {
      const acceptedGroupCalls = await this.callSessionModel
        .find(
          {
            status: CallSessionStatus.ACCEPTED,
            isGroupCall: true,
          },
          { _id: 1, updatedAt: 1 },
        )
        .sort({ _id: 1 })
        .skip(emptyRoomOffset)
        .limit(this.rehydrateBatchSize)
        .lean()
        .exec();

      if (!acceptedGroupCalls.length) break;

      await this.callService.scheduleEmptyRoomTimeoutBulk(
        acceptedGroupCalls.map((item) => ({
          callId: item._id.toString(),
          deadline: new Date(
            new Date((item as any).updatedAt as Date).getTime() +
              Number(process.env.GROUP_CALL_EMPTY_ROOM_TIMEOUT_MS ?? 15_000),
          ),
        })),
      );

      emptyRoomCount += acceptedGroupCalls.length;
      emptyRoomOffset += acceptedGroupCalls.length;
    }

    this.logger.log(
      `Rehydrated timeout schedules: ringing=${ringCount}, accepted=${reconnectCount}, emptyRoom=${emptyRoomCount}`,
    );
  }
}
