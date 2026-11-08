/**
 * kafka-test-producer.helper.ts
 * Manages test event streaming, DLQ quarantine, retry policies and broker outages.
 */

import { EventTopic } from '@repo/dtos';

export interface KafkaMessageRecord {
  topic: string;
  key?: string;
  value: any;
  headers?: Record<string, string>;
  timestamp: number;
}

export class KafkaTestProducerHelper {
  private topicStore: Map<string, KafkaMessageRecord[]> = new Map();
  private dlqStore: Map<string, KafkaMessageRecord[]> = new Map();
  private isBrokerOnline: boolean = true;
  private pendingBuffer: KafkaMessageRecord[] = [];

  constructor() {
    // Initialize common topics
    Object.values(EventTopic).forEach((topic) => {
      this.topicStore.set(topic, []);
      this.dlqStore.set(`${topic}.DLQ`, []);
    });
  }

  /**
   * Pause Kafka broker (simulating `docker compose pause kafka`).
   */
  pauseBroker(): void {
    this.isBrokerOnline = false;
  }

  /**
   * Unpause Kafka broker and flush buffered messages.
   */
  unpauseBroker(): KafkaMessageRecord[] {
    this.isBrokerOnline = true;
    const flushed: KafkaMessageRecord[] = [];
    while (this.pendingBuffer.length > 0) {
      const msg = this.pendingBuffer.shift()!;
      this.publishDirect(msg.topic, msg.value, msg.key, msg.headers);
      flushed.push(msg);
    }
    return flushed;
  }

  get isOnline(): boolean {
    return this.isBrokerOnline;
  }

  get pendingBufferSize(): number {
    return this.pendingBuffer.length;
  }

  /**
   * Publishes an event to a topic, buffering if broker is paused.
   */
  async emit(
    topic: string,
    value: any,
    key?: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: 'PUBLISHED' | 'BUFFERED'; messageId: string }> {
    const record: KafkaMessageRecord = {
      topic,
      key,
      value,
      headers,
      timestamp: Date.now(),
    };

    if (!this.isBrokerOnline) {
      this.pendingBuffer.push(record);
      return { status: 'BUFFERED', messageId: `buf-${Date.now()}` };
    }

    this.publishDirect(topic, value, key, headers);
    return { status: 'PUBLISHED', messageId: `msg-${Date.now()}` };
  }

  private publishDirect(
    topic: string,
    value: any,
    key?: string,
    headers: Record<string, string> = {},
  ): void {
    const list = this.topicStore.get(topic) || [];
    list.push({ topic, key, value, headers, timestamp: Date.now() });
    this.topicStore.set(topic, list);
  }

  /**
   * Routes a poison pill event to Dead Letter Queue (DLQ) with retry verification.
   */
  async routeToDLQ(topic: string, value: any, errorReason: string, attempts: number = 3): Promise<void> {
    const dlqTopic = `${topic}.DLQ`;
    const list = this.dlqStore.get(dlqTopic) || [];
    list.push({
      topic: dlqTopic,
      value: {
        originalPayload: value,
        errorReason,
        retryCount: attempts,
        quarantinedAt: new Date().toISOString(),
      },
      timestamp: Date.now(),
    });
    this.dlqStore.set(dlqTopic, list);
  }

  getTopicRecords(topic: string): KafkaMessageRecord[] {
    return this.topicStore.get(topic) || [];
  }

  getDLQRecords(topic: string): KafkaMessageRecord[] {
    const dlqTopic = topic.endsWith('.DLQ') ? topic : `${topic}.DLQ`;
    return this.dlqStore.get(dlqTopic) || [];
  }

  clear(): void {
    this.topicStore.clear();
    this.dlqStore.clear();
    this.pendingBuffer = [];
    this.isBrokerOnline = true;
  }
}
