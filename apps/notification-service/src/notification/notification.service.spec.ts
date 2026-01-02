import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { CreateNotificationDto } from '@repo/dtos';
import { Notification } from 'src/mongo/schema/notification.schema';
import { UserPreferenceService } from 'src/user-preference/user-preference.service';
import { NotificationService } from './notification.service';
import { TemplateService } from './template.service';

describe('NotificationService (unit)', () => {
  let service: NotificationService;

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
                Promise.resolve({ ...dto, _id: '123' })
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
                allowedChannels: ['web'],
                limits: { dailyLimit: 10 },
              }),
            checkAndIncrementDailyLimit: jest.fn().mockResolvedValue(true),
          },
        },
        { provide: 'RABBITMQ_CHANNEL', useValue: { publish: jest.fn() } },
        { provide: 'BullQueue_notifications', useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  it('should create notification and publish immediately', async () => {
    const dto = {
      userId: 'user1',
      type: 'welcome',
      payload: { name: 'Alice' },
      channels: ['web'],
    };
    const result = await service.create(dto);

    expect(result._id).toBeDefined();
    expect(service['rabbitChannel'].publish).toHaveBeenCalled();
  });

  it('should schedule notification via Bull if sendAt is in future', async () => {
    const future = new Date(Date.now() + 10000);
    const dto : CreateNotificationDto = {
      requestId: 'req-1',
      userId: 'user1',
      type: 'reminder',
      payload: {},
      channels: ['web'],
      sendAt: future,
    };
    const result = await service.create(dto);

    expect(service['notificationQueue'].add).toHaveBeenCalled();
    expect(result._id).toBeDefined();
  });
});

