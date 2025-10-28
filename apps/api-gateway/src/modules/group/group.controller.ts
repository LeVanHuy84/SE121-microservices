import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';

@Controller('groups')
export class GroupController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private client: ClientProxy
  ) {}

  @Get('health')
  healthCheck() {
    return this.client.send('health_check', {});
  }
}
