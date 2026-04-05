import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisTrendingWarmupService } from './redis-trending-warmup.service';

@Injectable()
export class AppInitService implements OnModuleInit {
  private readonly logger = new Logger(AppInitService.name);

  constructor(
    private readonly redisTrendingWarmupService: RedisTrendingWarmupService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Running startup trending warmup check.');
    await this.redisTrendingWarmupService.ensureTrendingIndex();
  }
}
