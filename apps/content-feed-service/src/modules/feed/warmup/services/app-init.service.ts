import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisTrendingWarmupService } from './redis-trending-warmup.service';

@Injectable()
export class AppInitService implements OnModuleInit {
  private readonly logger = new Logger(AppInitService.name);

  constructor(
    private readonly redisTrendingWarmupService: RedisTrendingWarmupService,
  ) {}

  onModuleInit(): void {
    this.logger.log('Scheduling startup trending warmup check (asynchronous).');
    this.redisTrendingWarmupService.ensureTrendingIndex().catch((err) => {
      this.logger.error('Startup trending warmup check failed asynchronously', err);
    });
  }
}
