import { KafkaDLQService } from './kafka-dlq.service';
import type { KafkaProducerService } from '../../kafka-producer';

describe('KafkaDLQService (Suite 3)', () => {
  let service: KafkaDLQService;
  let mockProducer: jest.Mocked<KafkaProducerService>;

  beforeEach(() => {
    mockProducer = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    } as unknown as jest.Mocked<KafkaProducerService>;

    service = new KafkaDLQService(mockProducer);
  });

  it('TC-COM-10: should route failed message to destination topic ending with .DLQ', async () => {
    const topic = 'post-events';
    const message = { id: 'post-123', action: 'create' };
    const error = new Error('Parse error');

    await service.send(topic, message, error);

    expect(mockProducer.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockProducer.sendMessage).toHaveBeenCalledWith(
      'post-events.DLQ',
      expect.any(Object),
    );
  });

  it('TC-COM-11: should construct complete DLQ payload with metadata, error stack, and timestamp', async () => {
    const topic = 'chat-events';
    const message = { conversationId: 'c-1', content: 'hello' };
    const error = new Error('Database disconnected');
    error.stack = 'Error: Database disconnected\n    at Object.<anonymous>';
    const metadata = { correlationId: 'corr-999', retryCount: 3 };

    await service.send(topic, message, error, metadata);

    expect(mockProducer.sendMessage).toHaveBeenCalledWith(
      'chat-events.DLQ',
      expect.objectContaining({
        originalTopic: 'chat-events',
        message: { conversationId: 'c-1', content: 'hello' },
        error: {
          message: 'Database disconnected',
          stack: error.stack,
        },
        metadata: {
          correlationId: 'corr-999',
          retryCount: 3,
        },
        failedAt: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
      }),
    );
  });

  it('should handle undefined metadata and unknown error gracefully', async () => {
    const topic = 'user-events';
    const message = { userId: 'u-1' };

    await service.send(topic, message, 'Unexpected string failure');

    expect(mockProducer.sendMessage).toHaveBeenCalledWith(
      'user-events.DLQ',
      expect.objectContaining({
        originalTopic: 'user-events',
        message: { userId: 'u-1' },
        error: {
          message: undefined,
          stack: undefined,
        },
        metadata: {},
        failedAt: expect.any(String),
      }),
    );
  });
});

