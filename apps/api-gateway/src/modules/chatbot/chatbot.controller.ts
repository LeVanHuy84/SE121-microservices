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
} from "@nestjs/common";
import { AssistantMessageDto } from "@repo/dtos";
import { CurrentUserId } from "src/common/decorators/current-user-id.decorator";
import { ChatbotService } from "./chatbot.service";
import { Observable } from "rxjs";

@Controller("assistant")
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Sse("messages-stream")
  respondStream(
    @CurrentUserId() userId: string,
    @Query() dto: AssistantMessageDto,
  ): Observable<MessageEvent> {
    // Explicitly set headers to disable buffering in proxies like Nginx
    return this.chatbotService.respondStream(userId, dto);
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
