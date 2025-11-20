import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor(
    private readonly brokers: string[],
    private readonly clientId: string
  ) {
    this.kafka = new Kafka({ brokers: this.brokers, clientId: this.clientId });
    this.producer = this.producer = this.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1, // đảm bảo thứ tự + exactly-once
      retry: {
        retries: 5,
      },
    });
  }

  async onModuleInit() {
    await this.producer.connect();
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }

  async sendMessage(topic: string, message: any, aggregateId?: string) {
    await this.producer.send({
      topic,
      messages: [
        {
          key: aggregateId || null,
          value: JSON.stringify(message),
        },
      ],
    });
  }
}
