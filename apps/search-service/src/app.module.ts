import { Module } from '@nestjs/common';
import { SearchModule } from './modules/search-all/search.module';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchModule } from './elastic/elastic.module';
import { IndexerModule } from './modules/indexer/indexer.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    ScheduleModule.forRoot(),
    ElasticsearchModule,
    SearchModule,
    IndexerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
