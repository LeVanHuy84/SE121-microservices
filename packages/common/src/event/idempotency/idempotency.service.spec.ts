import { IdempotencyService, IdempotencyBusyError } from './idempotency.service';
import type { IdempotencyRepository } from './idempotency.interface';

describe('IdempotencyService (Suite 2)', () => {
  let service: IdempotencyService;
  let mockRepo: jest.Mocked<IdempotencyRepository>;

  beforeEach(() => {
    mockRepo = {
      tryStart: jest.fn(),
      isDone: jest.fn(),
      markDone: jest.fn(),
    };
    service = new IdempotencyService(mockRepo);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('TC-COM-05: should process new event when repo returns STARTED and mark done', async () => {
    mockRepo.tryStart.mockResolvedValue('STARTED');
    mockRepo.markDone.mockResolvedValue(undefined);

    const handler = jest.fn().mockResolvedValue(undefined);

    await service.execute({
      eventId: 'evt-001',
      handler,
    });

    expect(mockRepo.tryStart).toHaveBeenCalledTimes(1);
    expect(mockRepo.tryStart).toHaveBeenCalledWith({
      eventId: 'evt-001',
      staleAfterMs: 10000,
      session: undefined,
      manager: undefined,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockRepo.markDone).toHaveBeenCalledTimes(1);
    expect(mockRepo.markDone).toHaveBeenCalledWith({
      eventId: 'evt-001',
      session: undefined,
      manager: undefined,
    });
  });

  it('TC-COM-06: should skip processing when repo returns DONE', async () => {
    mockRepo.tryStart.mockResolvedValue('DONE');

    const handler = jest.fn().mockResolvedValue(undefined);

    await service.execute({
      eventId: 'evt-002',
      handler,
    });

    expect(mockRepo.tryStart).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    expect(mockRepo.markDone).not.toHaveBeenCalled();
  });

  it('TC-COM-07: should wait and skip if initial attempt is BUSY and subsequent is DONE', async () => {
    jest.useFakeTimers();

    mockRepo.tryStart
      .mockResolvedValueOnce('BUSY')
      .mockResolvedValueOnce('DONE');

    const handler = jest.fn().mockResolvedValue(undefined);

    const executePromise = service.execute({
      eventId: 'evt-003',
      handler,
    });
    executePromise.catch(() => {});

    // Advance timer past CLAIM_RETRY_INTERVAL_MS (1000ms)
    await jest.advanceTimersByTimeAsync(1000);
    await executePromise;

    expect(mockRepo.tryStart).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
    expect(mockRepo.markDone).not.toHaveBeenCalled();
  });

  it('TC-COM-08: should throw IdempotencyBusyError when event remains BUSY past acquireDeadline', async () => {
    jest.useFakeTimers();

    // With staleAfterMs: 2000, deadline = Date.now() + 2000 + 1000 = +3000ms
    mockRepo.tryStart.mockResolvedValue('BUSY');

    const handler = jest.fn().mockResolvedValue(undefined);

    const executePromise = service.execute({
      eventId: 'evt-busy-timeout',
      handler,
      staleAfterMs: 2000,
    });
    executePromise.catch(() => {});

    // Advance through retries until deadline exceeded
    await jest.advanceTimersByTimeAsync(4000);

    await expect(executePromise).rejects.toThrow(IdempotencyBusyError);
    await expect(executePromise).rejects.toThrow(
      'Event evt-busy-timeout is already being processed',
    );
    expect(handler).not.toHaveBeenCalled();
    expect(mockRepo.markDone).not.toHaveBeenCalled();
  });

  it('TC-COM-09: should not markDone and rethrow error when handler throws', async () => {
    mockRepo.tryStart.mockResolvedValue('STARTED');
    const handlerError = new Error('Database transaction failed');
    const handler = jest.fn().mockRejectedValue(handlerError);

    await expect(
      service.execute({
        eventId: 'evt-error',
        handler,
      }),
    ).rejects.toThrow('Database transaction failed');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockRepo.markDone).not.toHaveBeenCalled();
  });

  it('should delegate isDone check to repository', async () => {
    mockRepo.isDone.mockResolvedValue(true);

    const result = await service.isDone('evt-001');

    expect(result).toBe(true);
    expect(mockRepo.isDone).toHaveBeenCalledWith({
      eventId: 'evt-001',
      session: undefined,
      manager: undefined,
    });
  });
});
