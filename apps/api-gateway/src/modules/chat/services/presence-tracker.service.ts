import { InjectRedis } from "@nestjs-modules/ioredis";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Server, Socket } from "socket.io";
import Redis from "ioredis";
import type {
  PresenceDisconnectEvent,
  PresenceHeartbeatEvent,
  PresenceInfo,
  PresenceStatus,
  PresenceUpdateEvent,
} from "@repo/dtos";

@Injectable()
export class PresenceTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceTrackerService.name);
  private readonly presenceEventsChannel = "presence:events";
  private readonly presenceUpdatesChannel = "presence:updates";
  private sub: Redis;
  private server: Server;

  private serverId =
    process.env.GATEWAY_INSTANCE_ID ||
    process.env.HOSTNAME ||
    `${process.pid}-${Math.random().toString(36).slice(2, 6)}`;

  private readonly HEARTBEAT_MIN_INTERVAL_MS = Number(
    process.env.PRESENCE_HEARTBEAT_MIN_INTERVAL_MS ?? 5000,
  );

  constructor(@InjectRedis() private readonly redis: Redis) {}

  setServer(server: Server) {
    this.server = server;
  }

  async onModuleInit() {
    this.sub = this.redis.duplicate();

    await this.sub.subscribe(this.presenceUpdatesChannel);
    this.sub.on("message", (channel, message) => {
      if (channel !== this.presenceUpdatesChannel) return;
      this.handlePresenceUpdateMessage(message);
    });

    this.logger.log("PresenceTrackerService subscribed to presence:updates");
  }

  async onModuleDestroy() {
    if (this.sub) {
      this.sub.removeAllListeners();
      this.sub.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.user?.id;
    if (!userId) return;

    const evt: PresenceDisconnectEvent = {
      type: "DISCONNECT",
      userId,
      serverId: this.serverId,
      connectionId: client.id,
      ts: Date.now(),
    };

    await this.redis.publish(this.presenceEventsChannel, JSON.stringify(evt));
  }

  async handleHeartbeat(
    client: Socket,
    refreshActiveConversation: (client: Socket) => Promise<void>,
  ) {
    const userId = client.user?.id as string;
    if (!userId) return;
    const now = Date.now();
    const lastHeartbeatAt = client.data.lastHeartbeatAt as number | undefined;
    if (
      lastHeartbeatAt &&
      now - lastHeartbeatAt < this.HEARTBEAT_MIN_INTERVAL_MS
    ) {
      return;
    }
    client.data.lastHeartbeatAt = now;
    const evt: PresenceHeartbeatEvent = {
      type: "HEARTBEAT",
      userId,
      serverId: this.serverId,
      connectionId: client.id,
      ts: now,
    };

    await this.redis.publish(this.presenceEventsChannel, JSON.stringify(evt));
    await refreshActiveConversation(client);
  }

  async handleSubscribe(client: Socket, userIds: string[]) {
    if (!Array.isArray(userIds) || !userIds.length) return;

    const uniqueIds = Array.from(new Set(userIds)).filter(Boolean);
    if (!uniqueIds.length) return;
    uniqueIds.forEach((id) => client.join(`presence:${id}`));
    this.logger.debug(
      `Client ${client.id} subscribed presence of [${uniqueIds.join(", ")}]`,
    );
    const snapshot = await this.getPresenceSnapshot(uniqueIds);

    client.emit("presence.snapshot", snapshot);
  }

  handleUnsubscribe(client: Socket, userIds: string[]) {
    if (!Array.isArray(userIds) || !userIds.length) return;

    const uniqueIds = Array.from(new Set(userIds)).filter(Boolean);
    if (!uniqueIds.length) return;
    uniqueIds.forEach((id) => client.leave(`presence:${id}`));
    this.logger.debug(
      `Client ${client.id} unsubscribed presence of [${uniqueIds.join(", ")}]`,
    );
  }

  private handlePresenceUpdateMessage(message: string) {
    let evt: PresenceUpdateEvent;
    try {
      evt = JSON.parse(message);
    } catch (e) {
      this.logger.error("Invalid presence update message", e);
      return;
    }

    if (evt.type !== "PRESENCE_UPDATE") return;

    if (this.server) {
      this.server.to(`presence:${evt.userId}`).emit("presence.update", {
        userId: evt.userId,
        status: evt.status,
        lastSeen: evt.lastSeen,
      });
    }
  }

  private async getPresenceSnapshot(
    userIds: string[],
  ): Promise<Record<string, PresenceInfo>> {
    if (!userIds.length) return {};

    const pipeline = this.redis.pipeline();
    userIds.forEach((id) => pipeline.hgetall(`presence:user:${id}`));

    const results = await pipeline.exec();

    const snapshot: Record<string, PresenceInfo> = {};

    if (!results) return snapshot;

    results.forEach(([err, raw], idx) => {
      const userId = userIds[idx];

      if (err || !raw || Object.keys(raw as any).length === 0) {
        snapshot[userId] = {
          status: "offline",
          lastSeen: null,
        };
        return;
      }

      const hash = raw as Record<string, string>;

      const status = (hash.status ?? "offline") as PresenceStatus;
      const lastSeen =
        hash.lastSeen !== undefined && hash.lastSeen !== null
          ? Number(hash.lastSeen)
          : null;

      snapshot[userId] = {
        status,
        lastSeen,
        serverId: hash.lastServerId ?? null,
      };
    });

    return snapshot;
  }
}
