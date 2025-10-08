import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ImagesModule } from './images/images.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaModule } from './media/media.module';
import { EventStoreService } from './event-store/event-store.service';
import { EventStoreModule } from './event-store/event-store.module';
import { SagaOrchestratorModule } from './saga-orchestrator/saga-orchestrator.module';
import { OutboxModule } from './outbox/outbox.module';
import { WebhookModule } from './webhook/webhook.module';
import * as path from 'path';

  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
      }),
      TypeOrmModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          type: 'postgres',
          url: configService.get<string>('POSTGRES_URL'),
          entities: [path.resolve(__dirname, '.') + '/**/*.entity{.js,.ts}'],
          synchronize: true,
        }),
      }),
      ImagesModule,
      MediaModule,
      EventStoreModule,
      SagaOrchestratorModule,
      OutboxModule,
      WebhookModule,
    ],
    providers: [],
  })
  export class AppModule {}
