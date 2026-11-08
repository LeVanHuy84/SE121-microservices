import { OutboxService } from './outbox.service';

describe('OutboxService (Suite 5 & Recommendation 3: Transactional Outbox & Fallback)', () => {
  let service: OutboxService;
  let outboxModel: any;
  let chatStreamProducer: any;

  beforeEach(() => {
    function MockModel(this: any, data: any) {
      Object.assign(this, data);
      this._id = 'outbox-id-123';
      this.save = jest.fn().mockResolvedValue(this);
    }
    MockModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    outboxModel = MockModel;

    chatStreamProducer = {
      publishEvent: jest.fn().mockResolvedValue('stream-id-1'),
    };

    service = new OutboxService(outboxModel, chatStreamProducer);
  });

  it('enqueues a standard outbox event for Kafka forwarding', async () => {
    const event = await service.enqueue(
      'notification',
      'user.notified',
      { userId: 'u1' },
      'agg-1',
    );

    expect(event.topic).toBe('notification');
    expect(event.eventType).toBe('user.notified');
    expect(event.aggregateId).toBe('agg-1');
    expect(event.processed).toBe(false);
  });

  it('publishes chat event directly to Redis Stream when no Mongo session is provided', async () => {
    await service.enqueueChatEvent('message.created', { msg: 'hi' });

    expect(chatStreamProducer.publishEvent).toHaveBeenCalledWith(
      'message.created',
      { msg: 'hi' },
    );
  });

  it('persists fallback outbox event in Mongo and queues publish when session is active', async () => {
    const mockSession: any = { id: 'session-1' };

    await service.enqueueChatEvent(
      'message.created',
      { msg: 'hi inside tx' },
      'conv-1',
      mockSession,
    );

    // Direct publish should NOT be called yet
    expect(chatStreamProducer.publishEvent).not.toHaveBeenCalled();

    // Now flush pending chat events after commit
    await service.flushPendingChatEvents(mockSession);

    expect(chatStreamProducer.publishEvent).toHaveBeenCalledWith(
      'message.created',
      { msg: 'hi inside tx' },
    );
    expect(outboxModel.updateOne).toHaveBeenCalledWith(
      { _id: 'outbox-id-123' },
      expect.objectContaining({
        $set: expect.objectContaining({ processed: true }),
      }),
    );
  });

  it('clears pending chat events when transaction is aborted', async () => {
    const mockSession: any = { id: 'session-aborted' };

    await service.enqueueChatEvent(
      'message.created',
      { msg: 'aborted' },
      'conv-1',
      mockSession,
    );

    service.clearPendingChatEvents(mockSession);

    await service.flushPendingChatEvents(mockSession);
    expect(chatStreamProducer.publishEvent).not.toHaveBeenCalled();
  });
});
