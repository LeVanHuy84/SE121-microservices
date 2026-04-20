import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ChatbotController } from './chatbot.controller';

import { AssistantContextService } from './assistant-context.service';
import { ChatbotService } from './chatbot.service';

@Module({
  imports: [
    HttpModule,
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.SEARCH_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('SEARCH_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService, AssistantContextService],
})
export class ChatbotModule {}
