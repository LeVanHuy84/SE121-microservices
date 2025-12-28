import { DynamicModule, Global, Module } from '@nestjs/common';
import {
  connect,
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import * as amqp from 'amqplib';

export interface ExchangeConfig {
  name: string;
  type: 'topic' | 'direct' | 'fanout';
}

export interface RabbitmqModuleOptions {
  urls: string[];
  exchanges: ExchangeConfig[];
}

const DLX_EXCHANGE = 'dlx';
const DLX_QUEUE = 'dlx_queue';

@Global()
@Module({})
export class RabbitmqModule {
  static register(options: RabbitmqModuleOptions): DynamicModule {
    const connectionProvider = {
      provide: 'RABBITMQ_CONNECTION',
      useFactory: async (): Promise<AmqpConnectionManager> => {
        return connect(options.urls);
      },
    };

    const channelProvider = {
      provide: 'RABBITMQ_CHANNEL',
      useFactory: async (
        conn: AmqpConnectionManager
      ): Promise<ChannelWrapper> => {
        const channel = conn.createChannel({
          json: true,
          setup: async (ch: amqp.Channel) => {
            await ch.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });
            await ch.assertQueue(DLX_QUEUE, { durable: true });
            await ch.bindQueue(DLX_QUEUE, DLX_EXCHANGE, '#');

            for (const ex of options.exchanges) {
              await ch.assertExchange(ex.name, ex.type, { durable: true, arguments: {
                'x-dead-letter-exchange': 'dlx',
              } });
              await ch.assertQueue(`${ex.name}_queue`, { durable: true, arguments: {
                'x-dead-letter-exchange': 'dlx',
              } });
              await ch.bindQueue(
                `${ex.name}_queue`,
                ex.name,
                ex.type === 'fanout' ? '' : '#'
              );
            }
          },
        });
        return channel;
      },
      inject: ['RABBITMQ_CONNECTION'],
    };

    return {
      module: RabbitmqModule,
      providers: [connectionProvider, channelProvider],
      exports: [connectionProvider, channelProvider],
    };
  }
}
