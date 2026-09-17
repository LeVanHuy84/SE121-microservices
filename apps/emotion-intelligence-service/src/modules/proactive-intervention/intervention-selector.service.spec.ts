import { Test, TestingModule } from '@nestjs/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  InterventionSelectorService,
  SelectionContext,
} from './intervention-selector.service';
import { InterventionMediaType, RiskLevel } from '@repo/dtos';

describe('InterventionSelectorService', () => {
  let service: InterventionSelectorService;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    const module: TestingModule = await Test.createTestingModule({
      providers: [InterventionSelectorService],
    }).compile();

    service = module.get<InterventionSelectorService>(
      InterventionSelectorService,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('selectBestResource', () => {
    const context: SelectionContext = {
      userId: 'user1',
      riskLevel: RiskLevel.MODERATE_RISK,
      riskScore: 0.7,
      triggers: [],
      content: 'I feel very anxious and overwhelmed.',
      primaryEmotion: 'fear',
      emotionVector: { fear: 0.8 },
    };

    it('should return null when resources array is empty or undefined', async () => {
      expect(await service.selectBestResource([], context)).toBeNull();
      expect(await service.selectBestResource(null as any, context)).toBeNull();
    });

    it('should return the single resource directly if array length is 1', async () => {
      const resource = {
        _id: 'res1',
        title: 'Single Resource',
        priority: 1,
      } as any;
      const result = await service.selectBestResource([resource], context);
      expect(result).toBe(resource);
    });

    it('should use Groq AI selection when GROQ_API_KEY is present and response is valid', async () => {
      process.env.GROQ_API_KEY = 'mock_groq_key';
      const resources = [
        {
          _id: 'res1',
          title: 'Resource 1',
          mediaType: InterventionMediaType.AUDIO,
          priority: 1,
        },
        {
          _id: 'res2',
          title: 'Resource 2',
          mediaType: InterventionMediaType.INFOGRAPHIC,
          priority: 2,
        },
      ] as any[];

      const mockResponse = {
        ok: true,
        json: jest.fn<any>().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  selectedResourceId: 'res2',
                  reasoning: 'Matches panic/anxiety best.',
                }),
              },
            },
          ],
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as any);

      const result = await service.selectBestResource(resources, context);
      expect(result).toBe(resources[1]);
    });

    it('should fallback to Rule Matcher when Groq AI API returns non-ok status or throws error', async () => {
      process.env.GROQ_API_KEY = 'mock_groq_key';
      const resources = [
        {
          _id: 'res1',
          title: 'Audio Res',
          mediaType: InterventionMediaType.AUDIO,
          priority: 10,
        },
        {
          _id: 'res2',
          title: 'Infographic Res',
          mediaType: InterventionMediaType.INFOGRAPHIC,
          priority: 1,
        },
      ] as any[];

      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('Network Timeout'));

      // Context fear score = 0.8 -> Infographic gets priority boost: 1 + 5 + 0.8*3 = 8.4 > Audio (10)
      const result = await service.selectBestResource(resources, context);
      expect(result).toBeDefined();
      expect(result?._id).toBe('res1'); // Priority 10 wins over Infographic score (8.4)
    });

    describe('selectViaRuleMatcher (Emotion-Based Scoring)', () => {
      it('should boost Infographic / PDF for high fear score', async () => {
        delete process.env.GROQ_API_KEY;

        const fearContext: SelectionContext = {
          userId: 'user1',
          riskLevel: RiskLevel.HIGH_RISK,
          riskScore: 0.8,
          triggers: [],
          primaryEmotion: 'fear',
          emotionVector: { fear: 0.9 },
        };

        const resAudio = {
          _id: 'res_audio',
          title: 'Audio Relaxation',
          mediaType: InterventionMediaType.AUDIO,
          priority: 5,
        } as any;
        const resInfo = {
          _id: 'res_info',
          title: 'Breathing Infographic',
          mediaType: InterventionMediaType.INFOGRAPHIC,
          priority: 5,
        } as any;

        const result = await service.selectBestResource(
          [resAudio, resInfo],
          fearContext,
        );
        // Infographic score: 5 + 5 + 0.9 * 3 = 12.7 vs Audio score: 5
        expect(result).toBe(resInfo);
      });

      it('should boost Infographic/PDF/Video for high sadness score', async () => {
        delete process.env.GROQ_API_KEY;

        const sadnessContext: SelectionContext = {
          userId: 'user2',
          riskLevel: RiskLevel.MODERATE_RISK,
          riskScore: 0.6,
          triggers: [],
          primaryEmotion: 'sadness',
          emotionVector: { sadness: 0.9 },
        };

        const resAudio = {
          _id: 'res_audio',
          title: 'Audio Therapy',
          mediaType: InterventionMediaType.AUDIO,
          priority: 5,
        } as any;
        const resPdf = {
          _id: 'res_pdf',
          title: 'Depression Care PDF',
          mediaType: InterventionMediaType.PDF_DOCUMENT,
          priority: 5,
        } as any;

        const result = await service.selectBestResource(
          [resAudio, resPdf],
          sadnessContext,
        );
        // PDF score: 5 + 4 + 0.9 * 3 = 11.7 vs Audio: 5
        expect(result).toBe(resPdf);
      });

      it('should boost Infographic/Audio for high anger score', async () => {
        delete process.env.GROQ_API_KEY;

        const angerContext: SelectionContext = {
          userId: 'user3',
          riskLevel: RiskLevel.MODERATE_RISK,
          riskScore: 0.6,
          triggers: [],
          primaryEmotion: 'anger',
          emotionVector: { anger: 0.8 },
        };

        const resVideo = {
          _id: 'res_video',
          title: 'Calm Down Video',
          mediaType: InterventionMediaType.VIDEO,
          priority: 5,
        } as any;
        const resAudio = {
          _id: 'res_audio',
          title: 'Anger Release Audio',
          mediaType: InterventionMediaType.AUDIO,
          priority: 5,
        } as any;

        const result = await service.selectBestResource(
          [resVideo, resAudio],
          angerContext,
        );
        // Audio score: 5 + 4 + 0.8 * 2 = 10.6 vs Video: 5
        expect(result).toBe(resAudio);
      });
    });
  });

  describe('dispatchHotlines', () => {
    it('should return primary: undefined and secondary: [] when hotlines list is empty or null', () => {
      expect(service.dispatchHotlines([])).toEqual({
        primary: undefined,
        secondary: [],
      });
      expect(service.dispatchHotlines(null as any)).toEqual({
        primary: undefined,
        secondary: [],
      });
    });

    it('should prioritize open hotlines over closed hotlines', () => {
      // Monday (day 1) at 10:00 AM
      const monday10AM = new Date('2026-09-14T10:00:00Z');

      const hotline247 = {
        _id: 'h247',
        organizationName: '247 Line',
        is247: true,
        isPrimary: false,
        displayOrder: 2,
      } as any;

      const closedHotline = {
        _id: 'hClosed',
        organizationName: 'Night Line',
        is247: false,
        isPrimary: true,
        displayOrder: 1,
        operatingHoursConfig: {
          is247: false,
          daysOfWeek: [1], // Monday
          startTime: '20:00',
          endTime: '23:00',
        },
      } as any;

      const result = service.dispatchHotlines(
        [closedHotline, hotline247],
        monday10AM,
      );

      // Even though closedHotline isPrimary: true, it's currently closed at 10:00 AM, so hotline247 should be primary
      expect(result.primary?._id).toBe('h247');
      expect(result.secondary.map((h) => h._id)).toEqual(['hClosed']);
    });

    it('should sort by isPrimary first, then displayOrder when all hotlines are open', () => {
      const now = new Date('2026-09-14T10:00:00Z');

      const h1 = {
        _id: 'h1',
        is247: true,
        isPrimary: false,
        displayOrder: 1,
      } as any;

      const h2 = {
        _id: 'h2',
        is247: true,
        isPrimary: true,
        displayOrder: 5,
      } as any;

      const h3 = {
        _id: 'h3',
        is247: true,
        isPrimary: false,
        displayOrder: 0,
      } as any;

      const result = service.dispatchHotlines([h1, h2, h3], now);

      expect(result.primary?._id).toBe('h2'); // isPrimary: true wins
      expect(result.secondary.map((h) => h._id)).toEqual(['h3', 'h1']); // displayOrder 0 before 1
    });

    it('should handle daysOfWeek boundary condition correctly (Sunday = 7)', () => {
      // Sunday, Sept 13, 2026
      const sundayDate = new Date('2026-09-13T10:00:00Z');

      const sundayOnlyHotline = {
        _id: 'hSun',
        is247: false,
        isPrimary: true,
        operatingHoursConfig: {
          is247: false,
          daysOfWeek: [7], // Sunday
          startTime: '08:00',
          endTime: '18:00',
        },
      } as any;

      const weekdayOnlyHotline = {
        _id: 'hWeek',
        is247: false,
        isPrimary: false,
        operatingHoursConfig: {
          is247: false,
          daysOfWeek: [1, 2, 3, 4, 5],
          startTime: '08:00',
          endTime: '18:00',
        },
      } as any;

      const result = service.dispatchHotlines(
        [weekdayOnlyHotline, sundayOnlyHotline],
        sundayDate,
      );
      expect(result.primary?._id).toBe('hSun');
    });
  });
});
