import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Webhook } from "svix";
import { Public } from "src/common/decorators/public.decorator";
import { ClerkWebhookService } from "./clerk-webhook.service";

@Controller("webhooks/clerk")
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);

  constructor(private readonly webhookService: ClerkWebhookService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("svix-id") svixId: string,
    @Headers("svix-timestamp") svixTimestamp: string,
    @Headers("svix-signature") svixSignature: string,
  ) {
    // Verify webhook signature
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error("CLERK_WEBHOOK_SECRET is not configured");
      return { success: false };
    }

    const payload = req.rawBody?.toString() || JSON.stringify(req.body);

    try {
      const wh = new Webhook(webhookSecret);
      const evt = wh.verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as any;

      const { type, data } = evt;
      this.logger.log(`Received Clerk webhook: ${type}`);

      // Handle different event types
      switch (type) {
        case "user.created":
          await this.webhookService.handleUserCreated(data);
          break;
        case "user.updated":
          await this.webhookService.handleUserUpdated(data);
          break;
        case "session.ended":
          await this.webhookService.handleSessionEnded(data);
          break;
        case "session.removed":
          await this.webhookService.handleSessionEnded(data);
          break;
        case "user.deleted":
          await this.webhookService.handleUserDeleted(data);
          break;
        default:
          this.logger.debug(`Unhandled webhook type: ${type}`);
      }

      return { success: true };
    } catch (error) {
      this.logger.error("Webhook verification failed:", error);
      return { success: false };
    }
  }
}
