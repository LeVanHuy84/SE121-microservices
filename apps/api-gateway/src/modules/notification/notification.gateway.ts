import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { ProactiveInterventionDto } from "@repo/dtos";
import type { ChannelWrapper } from "amqp-connection-manager";
import * as amqp from "amqplib";
import { Server, Socket } from "socket.io";
import { clerkWsMiddleware } from "src/common/middlewares/clerk-ws.middleware";

@WebSocketGateway({
  namespace: "/notification",
  cors: {
    origin: "*",
  },
  transports: ["websocket"],
})
export class NotificationGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(NotificationGateway.name);

  constructor(
    @Inject("RABBITMQ_CHANNEL")
    private readonly rabbitmqChannel: ChannelWrapper,
  ) {}

  afterInit(server: Server) {
    server.use(clerkWsMiddleware);
    this.logger.log("NotificationGateway initialized with Clerk WS Middleware");
  }

  async onModuleInit() {
    if (!this.rabbitmqChannel) return;
    try {
      await this.rabbitmqChannel.addSetup(async (ch: amqp.Channel) => {
        const queueName = "api_gateway_proactive_queue";
        await ch.assertExchange("notification", "topic", { durable: true });
        await ch.assertQueue(queueName, { durable: true });
        await ch.bindQueue(queueName, "notification", "proactive.intervention");
        await ch.consume(queueName, (msg) => {
          if (msg) {
            try {
              const payload: ProactiveInterventionDto = JSON.parse(
                msg.content.toString(),
              );
              this.emitProactiveIntervention(payload.userId, payload);
              ch.ack(msg);
            } catch (err) {
              this.logger.error(
                "Error parsing proactive intervention RMQ message",
                err,
              );
              ch.nack(msg, false, false);
            }
          }
        });
      });
      this.logger.log(
        "Registered RabbitMQ consumer for proactive.intervention in NotificationGateway",
      );
    } catch (err) {
      this.logger.error(
        "Failed to setup RabbitMQ consumer in NotificationGateway",
        err,
      );
    }
  }

  handleConnection(client: Socket) {
    const userId = client.user?.id;
    if (!userId) {
      this.logger.warn("Unauthorized client connected to NotificationGateway");
      client.disconnect(true);
      return;
    }
    client.join(`user:${userId}`);
    this.logger.log(`Client connected to NotificationGateway: user:${userId}`);
  }

  handleDisconnect(client: Socket) {
    const userId = client.user?.id;
    if (userId) {
      this.logger.log(
        `Client disconnected from NotificationGateway: user:${userId}`,
      );
    }
  }

  emitProactiveIntervention(userId: string, payload: ProactiveInterventionDto) {
    if (!userId || !this.server) return;
    this.server
      .to(`user:${userId}`)
      .emit("proactive_intervention_triggered", payload);
    this.logger.log(
      `Emitted proactive_intervention_triggered to user:${userId} (riskLevel=${payload.riskLevel}, action=${payload.suggestedAction})`,
    );
  }
}
