import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  Inject,
} from "@nestjs/common";
import type { Request } from "express";
import * as crypto from "crypto";
import { Public } from "src/common/decorators/public.decorator";
import { ClientProxy } from "@nestjs/microservices";
import { MICROSERVICES_CLIENTS } from "src/common/constants";

@Controller("webhooks/stream")
export class StreamWebhookController {
  private readonly logger = new Logger(StreamWebhookController.name);

  constructor(
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE)
    private readonly chatClient: ClientProxy,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("x-signature") signature: string,
    @Body() body: any,
  ) {
    const streamApiSecret = process.env.STREAM_API_SECRET;
    if (!streamApiSecret) {
      this.logger.error("STREAM_API_SECRET is not configured");
      return { success: false };
    }

    if (!signature) {
      throw new UnauthorizedException("Missing x-signature header");
    }

    const payload = req.rawBody?.toString();
    if (!payload) {
      throw new UnauthorizedException("Missing raw body");
    }

    const expectedSignature = crypto
      .createHmac("sha256", streamApiSecret)
      .update(payload)
      .digest("hex");
    if (signature !== expectedSignature) {
      this.logger.warn(
        `Invalid Stream webhook signature. Expected: ${expectedSignature}, Received: ${signature}`,
      );
      throw new UnauthorizedException("Invalid signature");
    }

    const type = body.type;
    this.logger.log(`Received Stream webhook: ${type}`);

    // Call session ended (last person left or call was rejected/cancelled)
    if (type === "call.session_ended" || type === "call.ended") {
      const callId = body.call_cid?.replace("default:", "") || body.call?.id;
      if (callId) {
        this.chatClient.emit("handleStreamCallEndedWebhook", { callId });
      }
    }

    // Participant left - check if room is empty
    if (type === "call.participant_left") {
      const callId = body.call_cid?.replace("default:", "") || body.call?.id;
      const participantsCount = body.call?.session?.participants?.length || 0;
      if (callId && participantsCount === 0) {
        this.chatClient.emit("handleStreamCallEndedWebhook", { callId });
      }
    }

    return { success: true };
  }
}
