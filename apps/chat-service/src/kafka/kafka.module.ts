import { Module, Global } from '@nestjs/common';
import { Kafka, logLevel, Producer, Consumer } from 'kafkajs';

export const KAFKA = {
  CLIENT: 'KAFKA_CLIENT',
  PRODUCER: 'KAFKA_PRODUCER',
  CONSUMER_FACTORY: 'KAFKA_CONSUMER_FACTORY',
};

@Global()
@Module({
  providers: [
    {
      provide: KAFKA.CLIENT,
      useFactory: () => {
        const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(
          ',',
        );
        const clientId = process.env.KAFKA_CLIENT_ID || 'chat-app';
        return new Kafka({
          clientId,
          brokers,
          connectionTimeout: 5000,
          requestTimeout: 30000,
          logLevel: logLevel.ERROR,
          // add ssl/sasl here if needed
        });
      },
    },
    {
      provide: KAFKA.PRODUCER,
      inject: [KAFKA.CLIENT],
      useFactory: async (kafka: Kafka) => {
        const producer: Producer = kafka.producer({
          idempotent: true,
          maxInFlightRequests: 1,
          retry: { retries: 8, initialRetryTime: 300 },
        });
        await producer.connect();
        return producer;
      },
    },
    {
      provide: KAFKA.CONSUMER_FACTORY,
      inject: [KAFKA.CLIENT],
      useFactory: (kafka: Kafka) => {
        return (groupId: string) => kafka.consumer({ groupId });
      },
    },
  ],
  exports: [KAFKA.CLIENT, KAFKA.PRODUCER, KAFKA.CONSUMER_FACTORY],
})
export class KafkaModule {}
