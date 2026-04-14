import { Body, Controller, Post } from '@nestjs/common';
import { AssistantMessageDto } from '@repo/dtos';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { ChatbotService } from './chatbot.service';

@Controller('assistant')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('messages')
  respond(
    @CurrentUserId() userId: string,
    @Body() dto: AssistantMessageDto,
  ) {
    return this.chatbotService.respond(userId, dto);
  }
}
