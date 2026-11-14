import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import type { SeedAllOptions, SeedAllResult } from './seed.service';
import { SeedService } from './seed.service';

@Controller()
export class SeedController {
  constructor(private readonly seedService: SeedService) {}

  @TcpMessagePattern('seed.run')
  async seedAll(@Payload() options?: SeedAllOptions): Promise<SeedAllResult> {
    return this.seedService.seedAll(options);
  }
}
