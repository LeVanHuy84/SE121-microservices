import { Global, Module } from '@nestjs/common';
import { ElasticsearchModule } from 'src/elastic/elastic.module';
import { IndexerService } from './indexer.service';
import { FlushScheduler } from './flush.scheduler';

@Global()
@Module({
  imports: [ElasticsearchModule],
  providers: [IndexerService, FlushScheduler],
  exports: [IndexerService],
})
export class IndexerModule {}
