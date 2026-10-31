import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Sse,
  MessageEvent,
  Res,
} from "@nestjs/common";
import { AssistantMessageDto } from "@repo/dtos";
import { CurrentUserId } from "src/common/decorators/current-user-id.decorator";
import { ChatbotService } from "./chatbot.service";
import { Observable } from "rxjs";

@Controller("assistant")
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post("respond")
  respond(@CurrentUserId() userId: string, @Body() dto: AssistantMessageDto) {
    return this.chatbotService.respond(userId, dto);
  }

  @Post("respond-stream")
  async respondStream(
    @CurrentUserId() userId: string,
    @Body() dto: AssistantMessageDto,
    @Res() res: any, // use any or express Response
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const subscription = this.chatbotService
      .respondStream(userId, dto)
      .subscribe({
        next: (event) => {
          if (event.type) res.write(`event: ${event.type}\n`);
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        },
        error: (err) => {
          res.write(`event: error\n`);
          res.write(
            `data: ${JSON.stringify({ code: "ASSISTANT_STREAM_FAILED", message: err.message })}\n\n`,
          );
          res.end();
        },
        complete: () => {
          res.end();
        },
      });

    res.on("close", () => {
      subscription.unsubscribe();
    });
  }

  @Get("messages-stream")
  async messagesStream(
    @CurrentUserId() userId: string,
    @Query("message") message: string,
    @Query("clientMessageId") clientMessageId: string | undefined,
    @Query("surface") surfaceJson: string | undefined,
    @Res() res: any,
  ) {
    if (!message) {
      throw new BadRequestException("message is required");
    }

    let surface: any = undefined;
    if (surfaceJson) {
      try {
        surface = JSON.parse(surfaceJson);
      } catch {
        // Ignore JSON parse errors for surface
      }
    }

    const dto = {
      message,
      clientMessageId,
      surface,
    };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const subscription = this.chatbotService
      .respondStream(userId, dto)
      .subscribe({
        next: (event) => {
          if (event.type) res.write(`event: ${event.type}\n`);
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        },
        error: (err) => {
          res.write(`event: error\n`);
          res.write(
            `data: ${JSON.stringify({ code: "ASSISTANT_STREAM_FAILED", message: err.message })}\n\n`,
          );
          res.end();
        },
        complete: () => {
          res.end();
        },
      });

    res.on("close", () => {
      subscription.unsubscribe();
    });
  }

  @Get("chat-history/me")
  getHistory(
    @CurrentUserId() userId: string,
    @Query("page_size") pageSize?: string,
    @Query("before_created_at") beforeCreatedAt?: string,
    @Query("before_id") beforeId?: string,
  ) {
    const resolvedPageSize = this.parsePageSize(pageSize);
    return this.chatbotService.getHistory(
      userId,
      resolvedPageSize,
      beforeCreatedAt,
      beforeId,
    );
  }

  @Delete("chat-history/me")
  clearHistory(@CurrentUserId() userId: string) {
    return this.chatbotService.clearHistory(userId);
  }

  @Post("actions/click")
  recordActionClick(
    @CurrentUserId() userId: string,
    @Body() body: { actionId: string; destinationId: string },
  ) {
    return this.chatbotService.recordActionClick(userId, body);
  }

  private parsePageSize(pageSize?: string): number | undefined {
    if (!pageSize) {
      return undefined;
    }

    const parsed = Number(pageSize);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException("page_size must be a positive integer");
    }

    return parsed;
  }
}
