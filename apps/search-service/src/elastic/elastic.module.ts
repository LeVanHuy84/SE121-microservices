import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

export const ELASTIC_CLIENT = 'ELASTIC_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ELASTIC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Client({
          node: config.get<string>('ES_NODE'),
          auth: {
            username: config.get<string>('ES_USER', 'elastic'),
            password: config.get<string>('ES_PASS', 'password'),
          },
        });
      },
    },
  ],
  exports: [ELASTIC_CLIENT],
})
export class ElasticsearchModule {}
