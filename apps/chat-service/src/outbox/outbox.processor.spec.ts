import { OutboxProcessor } from './outbox.processor';
import { EventTopic } from '@repo/dtos';

describe('OutboxProcessor', () => {
  const outboxModel = {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };

  const kafkaProducer = {
    sendMessage: jest.fn(),
  };

  const chatStreamProducer = {
    publishEvent: jest.fn(),
  };

  const createProcessor = () =>
    new OutboxProcessor(
      outboxModel as any,
      kafkaProducer as any,
      chatStreamProducer as any
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('locks events with a processing lease instead of marking them processed', async () => {
    const processor = createProcessor();
    outboxModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: 'evt-1' }),
    });

    const locked = await (processor as any).lockEvent('evt-1');

    expect(locked).toBe(true);
    expect(outboxModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'evt-1',
        processed: false,
      }),
      expect.objectContaining({
        processing: true,
        lockedAt: expect.any(Date),
        lockedBy: expect.any(String),
      }),
      { new: true }
    );
  });

  it('marks the event processed only after kafka publish succeeds', async () => {
    const processor = createProcessor();
    const event = {
      id: 'evt-1',
      topic: 'chat',
      eventType: 'conversation.updated',
      payload: { ok: true },
      aggregateId: 'agg-1',
      processed: false,
      processing: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    kafkaProducer.sendMessage.mockResolvedValue(undefined);

    await (processor as any).processEvent(event);

    expect(kafkaProducer.sendMessage).toHaveBeenCalledWith(
      'chat',
      { type: 'conversation.updated', payload: { ok: true } },
      'agg-1'
    );
    expect(event.processed).toBe(true);
    expect(event.processing).toBe(false);
    expect(event.save).toHaveBeenCalled();
  });

  it('releases the lease and schedules retry when kafka publish fails', async () => {
    const processor = createProcessor();
    const event = {
      id: 'evt-1',
      topic: 'chat',
      eventType: 'conversation.updated',
      payload: { ok: true },
      aggregateId: 'agg-1',
      retryCount: 0,
    };
    kafkaProducer.sendMessage.mockRejectedValue(new Error('kafka down'));
    outboxModel.updateOne.mockResolvedValue(undefined);

    await (processor as any).processEvent(event);

    expect(outboxModel.updateOne).toHaveBeenCalledWith(
      { _id: 'evt-1' },
      expect.objectContaining({
        processed: false,
        processing: false,
        lockedAt: null,
        lockedBy: null,
        retryCount: 1,
        nextRetryAt: expect.any(Date),
        lastError: 'kafka down',
      })
    );
  });

  it('dispatches chat events to the durable realtime stream instead of Kafka', async () => {
    const processor = createProcessor();
    const event = {
      id: 'evt-chat-1',
      topic: EventTopic.CHAT,
      eventType: 'message.created',
      payload: { _id: 'msg-1', conversationId: 'conv-1' },
      aggregateId: 'conv-1',
      processed: false,
      processing: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    chatStreamProducer.publishEvent.mockResolvedValue(undefined);

    await (processor as any).processEvent(event);

    expect(chatStreamProducer.publishEvent).toHaveBeenCalledWith(
      'message.created',
      { _id: 'msg-1', conversationId: 'conv-1' }
    );
    expect(kafkaProducer.sendMessage).not.toHaveBeenCalled();
    expect(event.processed).toBe(true);
    expect(event.save).toHaveBeenCalled();
  });
});
