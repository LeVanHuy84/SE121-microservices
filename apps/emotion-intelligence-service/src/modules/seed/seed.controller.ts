import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { SeedAllOptions, SeedAllResult } from './seed.service';
import { SeedService } from './seed.service';

@Controller()
export class SeedController {
  constructor(private readonly seedService: SeedService) {}

  @MessagePattern('seed.run')
  async seedAll(@Payload() options?: SeedAllOptions): Promise<SeedAllResult> {
    return this.seedService.seedAll(options);
  }
}
