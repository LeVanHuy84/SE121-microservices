import { EmotionSignalService } from './emotion-signal.service';
import { of, throwError } from 'rxjs';
import { RiskLevel } from '@repo/dtos';

describe('EmotionSignalService', () => {
  let service: EmotionSignalService;
  let mockRedis: {
    get: jest.Mock;
    setex: jest.Mock;
    del: jest.Mock;
  };
  let mockEmotionClient: {
    send: jest.Mock;
  };

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    mockEmotionClient = {
      send: jest.fn(),
    };

    service = new EmotionSignalService(
      mockRedis as any,
      mockEmotionClient as any,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('TC-MUS-04: getUserEmotionSignal Flow', () => {
    it('should return cached emotion signal when present in Redis', async () => {
      const cached = {
        userId: 'user-1',
        riskLevel: RiskLevel.NORMAL,
        dominantEmotion: 'joy',
        valence: 0.8,
        arousal: 0.6,
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

      const result = await service.getUserEmotionSignal('user-1');

      expect(result).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          dominantEmotion: 'joy',
        }),
      );
      expect(mockEmotionClient.send).not.toHaveBeenCalled();
    });

    it('should fetch from EMOTION_INTELLIGENCE_SERVICE, normalize and cache when cache miss', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const remoteSignal = {
        userId: 'user-1',
        riskLevel: RiskLevel.NORMAL,
        dominantEmotion: 'joy',
        emotionScores: { joy: 0.8, sadness: 0.2 },
      };
      mockEmotionClient.send.mockReturnValueOnce(of(remoteSignal));

      const result = await service.getUserEmotionSignal('user-1');

      expect(mockEmotionClient.send).toHaveBeenCalledWith(
        'get_user_emotion_signal',
        { userId: 'user-1' },
      );
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'cache:emotion:signal:user-1',
        900,
        expect.any(String),
      );
      expect(result).toBeDefined();
      expect(result?.userId).toBe('user-1');
      expect((result as any)?.dominantEmotion).toBe('joy');
    });

    it('should safely return null and log warning when emotion service call fails', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockEmotionClient.send.mockReturnValueOnce(
        throwError(() => new Error('ECONNREFUSED 127.0.0.1:4005')),
      );

      const result = await service.getUserEmotionSignal('user-1');

      expect(result).toBeNull();
    });
  });

  describe('invalidateUserCache', () => {
    it('should delete user cache key from redis', async () => {
      await service.invalidateUserCache('user-1');

      expect(mockRedis.del).toHaveBeenCalledWith('cache:emotion:signal:user-1');
    });
  });
});
