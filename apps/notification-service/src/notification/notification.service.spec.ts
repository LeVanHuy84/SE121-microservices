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
  let firebaseService: FirebaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getModelToken(Notification.name),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest
              .fn()
              .mockImplementation((dto) =>
                Promise.resolve({ ...dto, _id: '123', toObject: () => dto })
              ),
          },
        },
        {
          provide: TemplateService,
          useValue: { render: jest.fn().mockReturnValue('Hello') },
        },
        {
          provide: UserPreferenceService,
          useValue: {
            getUserPreferences: jest
              .fn()
              .mockResolvedValue({
                allowedChannels: ['push'],
                limits: { dailyLimit: 10 },
              }),
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
            zadd: jest.fn().mockResolvedValue(1),
            hset: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
          },
        },
        { provide: 'BullQueue_notifications', useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    firebaseService = module.get<FirebaseService>(FirebaseService);
  });

  it('should create notification and send push via FCM', async () => {
    const dto = {
      userId: 'user1',
      type: 'welcome',
      payload: { name: 'Alice' },
      channels: ['push'],
    };
    const result = await service.create(dto);

    expect(result._id).toBeDefined();
    expect(firebaseService.sendToMultipleDevices).toHaveBeenCalled();
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
    const result = await service.create(dto);

    expect(service['notificationQueue'].add).toHaveBeenCalled();
    expect(result._id).toBeDefined();
  });
});

