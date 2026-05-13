import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { CreateNotificationDto } from '@repo/dtos';
import { Notification } from 'src/mongo/schema/notification.schema';
import { UserPreferenceService } from 'src/user-preference/user-preference.service';
import { NotificationService } from './notification.service';
import { TemplateService } from './template.service';
import { FirebaseService } from 'src/firebase/firebase.service';
import { DeviceTokenService } from 'src/firebase/device-token.service';

describe('NotificationService (unit)', () => {
  let service: NotificationService;
  let notificationQueue: { add: jest.Mock };
  let userPreferenceService: UserPreferenceService;

  beforeEach(async () => {
    notificationQueue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getModelToken(Notification.name),
          useValue: {
            findOne: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(null),
            }),
            create: jest
              .fn()
              .mockImplementation((dto) =>
                Promise.resolve({ ...dto, _id: '123', toObject: () => dto })
              ),
          },
        },
        {
          provide: TemplateService,
          useValue: {
            render: jest.fn().mockReturnValue('Xin chao'),
            renderTemplate: jest.fn().mockReturnValue({
              title: 'Thong bao',
              body: 'Xin chao',
              data: {},
              delivery: { androidChannelId: 'general' },
            }),
          },
        },
        {
          provide: UserPreferenceService,
          useValue: {
            getUserPreferences: jest
              .fn()
              .mockResolvedValue({
                allowedChannels: ['push'],
                limits: { dailyLimit: 10, burstLimit: 3, burstWindowSeconds: 60 },
              }),
            reserveNotificationSlot: jest.fn().mockResolvedValue({
              allowed: true,
              dailyCount: 1,
              burstCount: 1,
            }),
            releaseNotificationSlot: jest.fn().mockResolvedValue(undefined),
            checkAndIncrementDailyLimit: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: FirebaseService,
          useValue: {
            sendToMultipleDevices: jest.fn().mockResolvedValue({
              successCount: 1,
              failureCount: 0,
              invalidTokens: [],
            }),
          },
        },
        {
          provide: DeviceTokenService,
          useValue: {
            getActiveTokensByUserId: jest
              .fn()
              .mockResolvedValue([{ token: 'test-token', platform: 'ios' }]),
            markTokensAsInvalid: jest.fn(),
          },
        },
        {
          provide: 'default_IORedisModuleConnectionToken',
          useValue: {
            exists: jest.fn().mockResolvedValue(0),
            zrevrangebyscore: jest.fn().mockResolvedValue([]),
            hmget: jest.fn().mockResolvedValue([]),
            multi: jest.fn().mockReturnValue({
              zadd: jest.fn().mockReturnThis(),
              hset: jest.fn().mockReturnThis(),
              expire: jest.fn().mockReturnThis(),
              del: jest.fn().mockReturnThis(),
              zremrangebyrank: jest.fn().mockReturnThis(),
              exec: jest.fn().mockResolvedValue([]),
            }),
          },
        },
        { provide: 'BullQueue_notifications', useValue: notificationQueue },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    userPreferenceService = module.get<UserPreferenceService>(UserPreferenceService);
  });

  it('should create notification and enqueue delivery job', async () => {
    const dto = {
      userId: 'user1',
      type: 'welcome',
      payload: { name: 'Alice' },
      channels: ['push'],
    };
    const result = await service.createAndEnqueue(dto);

    expect(result._id).toBeDefined();
    expect(notificationQueue.add).toHaveBeenCalledWith(
      'deliver-regular-notification',
      { id: '123' },
      expect.objectContaining({
        jobId: 'regular:123',
        attempts: 5,
      }),
    );
  });

  it('should schedule notification via Bull if sendAt is in future', async () => {
    const future = new Date(Date.now() + 10000);
    const dto: CreateNotificationDto = {
      requestId: 'req-1',
      userId: 'user1',
      type: 'reminder',
      payload: {},
      channels: ['push'],
      sendAt: future,
    };
    const result = await service.createAndEnqueue(dto);

    expect(service['notificationQueue'].add).toHaveBeenCalled();
    expect(result._id).toBeDefined();
  });

  it('should persist a rate-limited notification when burst limit is exceeded', async () => {
    jest
      .spyOn(userPreferenceService, 'reserveNotificationSlot')
      .mockResolvedValue({
        allowed: false,
        reason: 'burst',
        dailyCount: 4,
        burstCount: 4,
      });

    const result = await service.createAndEnqueue({
      userId: 'user1',
      type: 'comment',
      payload: { content: 'hello' } as any,
      channels: ['push'],
    });

    expect(notificationQueue.add).not.toHaveBeenCalled();
    expect(result.meta).toEqual(
      expect.objectContaining({
        rateLimited: true,
        rateLimitReason: 'burst',
      }),
    );
  });

  it('should rollback reserved rate-limit slot when enqueue fails', async () => {
    jest.spyOn(notificationQueue, 'add').mockRejectedValue(new Error('queue down'));

    await expect(
      service.createAndEnqueue({
        userId: 'user1',
        type: 'comment',
        payload: { content: 'hello' } as any,
        channels: ['push'],
      }),
    ).rejects.toThrow('queue down');

    expect(userPreferenceService.releaseNotificationSlot).toHaveBeenCalledWith(
      'user1',
      'comment',
      expect.objectContaining({
        dailyLimit: 10,
        burstLimit: 3,
        burstWindowSeconds: 60,
      }),
    );
  });
});

