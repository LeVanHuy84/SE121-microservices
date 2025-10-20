import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject('KAFKA_CLIENT') private readonly kafkaClient: ClientKafka
  ) {}

  async onModuleInit() {
    await this.kafkaClient.connect();
  }

  async emit(topic: string, event: any) {
    this.kafkaClient.emit(topic, {
      ...event,
      ts: Date.now(),
    });
  }

  async send(topic: string, event: any) {
    return this.kafkaClient.send(topic, {
      ...event,
      ts: Date.now(),
    });
  }
  onModuleDestroy = async () => {
    if (this.kafkaClient) await this.kafkaClient.close();
  };

}
