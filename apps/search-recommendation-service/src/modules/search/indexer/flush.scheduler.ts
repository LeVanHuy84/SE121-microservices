import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IndexerService } from './indexer.service';

@Injectable()
export class FlushScheduler {
  private readonly logger = new Logger(FlushScheduler.name);
  constructor(private readonly indexer: IndexerService) {
    this.logger.log('🧩 FlushScheduler initialized');
  }

  @Cron('*/5 * * * * *') // mỗi 5 giây
  async autoFlush() {
    await this.indexer.flushAll();
  }
}
