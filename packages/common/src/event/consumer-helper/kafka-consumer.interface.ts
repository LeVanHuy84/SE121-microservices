// kafka-consumer.interface.ts

export interface KafkaHandlerPayload {
  topic: string;
  partition: number;
  message: any;
  eventId: string;
}

export type KafkaMessageHandler = (
  payload: KafkaHandlerPayload,
) => Promise<void>;

export interface KafkaConsumerConfig {
  groupId: string;
  brokers: string[];
}
