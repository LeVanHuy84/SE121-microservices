import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { DistributionController } from './distribution.controller';
import { DistributionService } from './distribution.service';
import { MICROSERVICE_CLIENT } from 'src/constants';
import { FeedItem, FeedItemSchema } from 'src/mongo/schema/feed-item.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FeedItem.name, schema: FeedItemSchema },
    ]),
    ClientsModule.registerAsync([
      {
        name: MICROSERVICE_CLIENT.SOCIAL_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.REDIS,
          options: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
          },
        }),
      },
    ]),
  ],
  controllers: [DistributionController],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
