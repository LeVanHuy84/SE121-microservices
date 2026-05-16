import { CallTimeoutWorker } from './call-timeout.worker';
import { CallSessionStatus } from '@repo/dtos';

describe('CallTimeoutWorker', () => {
  let callService: any;
  let callSessionModel: any;
  let worker: CallTimeoutWorker;

  beforeEach(() => {
    jest.clearAllMocks();

    callService = {
      popDueRingTimeoutCallIds: jest.fn().mockResolvedValue([]),
      popDueReconnectTimeoutCallIds: jest.fn().mockResolvedValue([]),
      popDueEmptyRoomTimeoutCallIds: jest.fn().mockResolvedValue([]),
      markMissedCallBySystem: jest.fn().mockResolvedValue(true),
      markReconnectTimeoutCallBySystem: jest.fn().mockResolvedValue(true),
      markEmptyRoomTimeoutCallBySystem: jest.fn().mockResolvedValue(true),
      scheduleRingTimeoutBulk: jest.fn().mockResolvedValue(undefined),
      scheduleReconnectTimeoutBulk: jest.fn().mockResolvedValue(undefined),
      scheduleEmptyRoomTimeoutBulk: jest.fn().mockResolvedValue(undefined),
    };

    callSessionModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };

    worker = new CallTimeoutWorker(callSessionModel as any, callService);
  });

  describe('processTimeouts', () => {
    it('processes expired ringing calls', async () => {
      callService.popDueRingTimeoutCallIds.mockResolvedValue(['call-1', 'call-2']);

      await worker.processTimeouts();

      expect(callService.markMissedCallBySystem).toHaveBeenCalledTimes(2);
      expect(callService.markMissedCallBySystem).toHaveBeenCalledWith('call-1');
      expect(callService.markMissedCallBySystem).toHaveBeenCalledWith('call-2');
    });

    it('processes expired reconnect timeout calls', async () => {
      callService.popDueReconnectTimeoutCallIds.mockResolvedValue(['call-3']);

      await worker.processTimeouts();

      expect(callService.markReconnectTimeoutCallBySystem).toHaveBeenCalledWith('call-3');
    });

    it('processes expired empty room timeout calls', async () => {
      callService.popDueEmptyRoomTimeoutCallIds.mockResolvedValue(['call-4']);

      await worker.processTimeouts();

      expect(callService.markEmptyRoomTimeoutCallBySystem).toHaveBeenCalledWith('call-4');
    });

    it('does nothing when no expired calls', async () => {
      await worker.processTimeouts();

      expect(callService.markMissedCallBySystem).not.toHaveBeenCalled();
      expect(callService.markReconnectTimeoutCallBySystem).not.toHaveBeenCalled();
      expect(callService.markEmptyRoomTimeoutCallBySystem).not.toHaveBeenCalled();
    });

    it('processes all three timeout types in single tick', async () => {
      callService.popDueRingTimeoutCallIds.mockResolvedValue(['ring-1']);
      callService.popDueReconnectTimeoutCallIds.mockResolvedValue(['reconnect-1']);
      callService.popDueEmptyRoomTimeoutCallIds.mockResolvedValue(['empty-1']);

      await worker.processTimeouts();

      expect(callService.markMissedCallBySystem).toHaveBeenCalledWith('ring-1');
      expect(callService.markReconnectTimeoutCallBySystem).toHaveBeenCalledWith('reconnect-1');
      expect(callService.markEmptyRoomTimeoutCallBySystem).toHaveBeenCalledWith('empty-1');
    });
  });

  describe('onModuleInit (rehydration)', () => {
    it('rehydrates ringing calls from Mongo into Redis', async () => {
      const futureDate = new Date(Date.now() + 30_000);
      const mockFind = jest.fn()
        .mockReturnValueOnce({
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([
            { _id: 'call-1', ringTimeoutAt: futureDate },
          ]),
        })
        .mockReturnValueOnce({
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        })
        // accepted calls (reconnect)
        .mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        });

      callSessionModel.find = mockFind;

      await worker.onModuleInit();

      expect(callService.scheduleRingTimeoutBulk).toHaveBeenCalledWith([
        { callId: 'call-1', deadline: futureDate },
      ]);
    });
  });
});
