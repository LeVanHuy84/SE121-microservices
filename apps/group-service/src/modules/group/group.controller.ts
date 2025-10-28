import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';

@Controller('group')
export class GroupController {
  @MessagePattern('health_check')
  async healthCheck() {
    return { status: 'ok' };
  }
}
