import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AssistantMessageDto } from '@repo/dtos';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { ChatbotService } from './chatbot.service';

@Controller('assistant')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('messages')
  respond(@CurrentUserId() userId: string, @Body() dto: AssistantMessageDto) {
    return this.chatbotService.respond(userId, dto);
  }

  @Get('chat-history/:userId')
  getHistory(
    @Param('userId') userId: string,
    @Query('page_size') pageSize?: string,
    @Query('before_created_at') beforeCreatedAt?: string,
    @Query('before_id') beforeId?: string,
  ) {
    const resolvedPageSize = this.parsePageSize(pageSize);
    return this.chatbotService.getHistory(
      userId,
      resolvedPageSize,
      beforeCreatedAt,
      beforeId,
    );
  }

  @Delete('chat-history/:userId')
  clearHistory(@Param('userId') userId: string) {
    return this.chatbotService.clearHistory(userId);
  }

  private parsePageSize(pageSize?: string): number | undefined {
    if (!pageSize) {
      return undefined;
    }

    const parsed = Number(pageSize);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('page_size must be a positive integer');
    }

    return parsed;
  }
}
