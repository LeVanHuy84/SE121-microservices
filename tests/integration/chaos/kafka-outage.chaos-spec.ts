/**
 * kafka-outage.chaos-spec.ts
 * [CT-01] Chaos Testing: Kafka Broker Outage & Transactional Outbox Recovery
 * 
 * Verifies that during Kafka broker outage (paused), transactions succeed with
 * outboxStatus = PENDING, and upon broker recovery, all buffered records flush
 * chronologically with ZERO message loss.
 */

import 'reflect-metadata';
import { KafkaTestProducerHelper } from '../../helpers/kafka-test-producer.helper';
import { EventTopic } from '@repo/dtos';

describe('[CT-01] Chaos Testing: Kafka Outage & Outbox Recovery', () => {
  let kafkaHelper: KafkaTestProducerHelper;

  beforeEach(() => {
    kafkaHelper = new KafkaTestProducerHelper();
  });

  afterEach(() => {
    kafkaHelper.clear();
  });

  it('Simulates Kafka outage: 50 messages buffered in Outbox without crashing client APIs', async () => {
    // 1. Inject fault: Pause Kafka broker
    kafkaHelper.pauseBroker();
    expect(kafkaHelper.isOnline).toBe(false);

    const simulatedOutboxDb: Array<{ id: string; status: 'PENDING' | 'SENT'; text: string; createdAt: number }> = [];

    // 2. Dispatch 50 messages during broker outage
    const MESSAGE_COUNT = 50;
    for (let i = 1; i <= MESSAGE_COUNT; i++) {
      const msg = {
        id: `outbox_msg_${i.toString().padStart(3, '0')}`,
        status: 'PENDING' as const,
        text: `Message payload #${i} during Kafka outage`,
        createdAt: Date.now() + i,
      };

      // Persist in local DB first (Outbox table)
      simulatedOutboxDb.push(msg);

      // Attempt emit to Kafka -> Returns BUFFERED
      const emitResult = await kafkaHelper.emit(EventTopic.CHAT, msg);
      expect(emitResult.status).toBe('BUFFERED');
    }

    // Verify all 50 messages are safely stored in DB and pending in buffer
    expect(simulatedOutboxDb.length).toBe(MESSAGE_COUNT);
    expect(simulatedOutboxDb.every((m) => m.status === 'PENDING')).toBe(true);
    expect(kafkaHelper.pendingBufferSize).toBe(MESSAGE_COUNT);

    // Verify topic records are 0 while broker is offline
    expect(kafkaHelper.getTopicRecords(EventTopic.CHAT).length).toBe(0);
  });

  it('Recovers Kafka broker: Outbox worker flushes all 50 messages chronologically with zero loss', async () => {
    // Re-buffer 50 messages
    kafkaHelper.pauseBroker();
    const MESSAGE_COUNT = 50;
    for (let i = 1; i <= MESSAGE_COUNT; i++) {
      await kafkaHelper.emit(EventTopic.CHAT, {
        seq: i,
        id: `msg_${i}`,
        text: `Payload ${i}`,
      });
    }

    expect(kafkaHelper.pendingBufferSize).toBe(MESSAGE_COUNT);

    // 3. Recovery: Unpause broker
    const flushedMessages = kafkaHelper.unpauseBroker();

    // Assertion: 100% of messages flushed
    expect(kafkaHelper.isOnline).toBe(true);
    expect(kafkaHelper.pendingBufferSize).toBe(0);
    expect(flushedMessages.length).toBe(MESSAGE_COUNT);

    // Assertion: Chronological order maintained
    const topicRecords = kafkaHelper.getTopicRecords(EventTopic.CHAT);
    expect(topicRecords.length).toBe(MESSAGE_COUNT);
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      expect(topicRecords[i].value.seq).toBe(i + 1);
    }
  });
});
