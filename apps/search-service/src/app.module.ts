import { Module } from '@nestjs/common';
import { SearchModule } from './modules/search-all/search.module';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchModule } from './elastic/elastic.module';
import { IndexerModule } from './modules/indexer/indexer.module';
import { ScheduleModule } from '@nestjs/schedule';
import { InitModule } from './modules/_init/init.module';

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
    InitModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
