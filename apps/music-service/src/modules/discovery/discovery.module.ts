import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmotionSignalService } from './emotion-signal.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'EMOTION_INTELLIGENCE_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host:
              config.get<string>('EMOTION_INTELLIGENCE_SERVICE_HOST') ||
              'localhost',
            port: config.get<number>('EMOTION_INTELLIGENCE_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [],
  providers: [EmotionSignalService],
  exports: [EmotionSignalService],
})
export class DiscoveryModule {}
