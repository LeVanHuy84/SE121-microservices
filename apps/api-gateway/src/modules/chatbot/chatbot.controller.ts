import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
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
  respond(
    @CurrentUserId() userId: string,
    @Body() dto: AssistantMessageDto,
    @Headers("authorization") authHeader?: string,
  ) {
    return this.chatbotService.respond(userId, dto, authHeader);
  }

  @Post("respond-stream")
  async respondStream(
    @CurrentUserId() userId: string,
    @Body() dto: AssistantMessageDto,
    @Res() res: any, // use any or express Response
    @Headers("authorization") authHeader?: string,
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const subscription = this.chatbotService
      .respondStream(userId, dto, authHeader)
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
    @Query("conversationId") conversationId: string | undefined,
    @Query("aiPolicy") aiPolicy: string | undefined,
    @Res() res: any,
    @Headers("authorization") authHeader?: string,
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
      conversationId,
      aiPolicy,
    };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const subscription = this.chatbotService
      .respondStream(userId, dto, authHeader)
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
    @Query("conversation_id") conversationId?: string,
  ) {
    const resolvedPageSize = this.parsePageSize(pageSize);
    return this.chatbotService.getHistory(
      userId,
      resolvedPageSize,
      beforeCreatedAt,
      beforeId,
      conversationId,
    );
  }

  @Get("conversations/me")
  getConversations(
    @CurrentUserId() userId: string,
    @Query("limit") limit?: string,
  ) {
    const resolvedLimit = limit ? Number(limit) : undefined;
    return this.chatbotService.getConversations(userId, resolvedLimit);
  }

  @Post("conversations/me")
  createConversation(
    @CurrentUserId() userId: string,
    @Body() body: { title?: string },
  ) {
    return this.chatbotService.createConversation(userId, body?.title);
  }

  @Delete("conversations/me/:conversationId")
  deleteConversation(
    @CurrentUserId() userId: string,
    @Param("conversationId") conversationId: string,
  ) {
    return this.chatbotService.deleteConversation(userId, conversationId);
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

  @Post("actions/execute")
  executeAction(
    @CurrentUserId() userId: string,
    @Headers("authorization") authHeader: string | undefined,
    @Body()
    body: {
      actionId: string;
      actionName: string;
      params?: Record<string, unknown>;
      idempotencyKey: string;
      aiPolicy?: string;
    },
  ) {
    return this.chatbotService.executeAction(userId, authHeader, body);
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
