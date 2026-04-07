import { Test, TestingModule } from '@nestjs/testing';
import { NotiTargetType } from '@repo/dtos';
import { RecentActivityBatch } from './recent-activity.batch';
import { NotificationService } from './rabbitmq/notification.service';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import { UserClientService } from '../client/user/user-client.service';

describe('RecentActivityBatch', () => {
  let service: RecentActivityBatch;

  const snapshotAndGetAll = jest.fn();
  const acknowledgeProcessingActivities = jest.fn();
  const requeueProcessingActivities = jest.fn();
  const sendNotification = jest.fn();
  const getUsers = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    snapshotAndGetAll.mockResolvedValue({});
    acknowledgeProcessingActivities.mockResolvedValue(undefined);
    requeueProcessingActivities.mockResolvedValue(undefined);
    sendNotification.mockResolvedValue(undefined);
    getUsers.mockResolvedValue({});

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RecentActivityBatch,
        {
          provide: RecentActivityBufferService,
          useValue: {
            snapshotAndGetAll,
            acknowledgeProcessingActivities,
            requeueProcessingActivities,
          },
        },
        {
          provide: UserClientService,
          useValue: {
            getUsers,
          },
        },
        {
          provide: NotificationService,
          useValue: {
            sendNotification,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(RecentActivityBatch);
  });

  it('should acknowledge successful notifications with a stable request id', async () => {
    snapshotAndGetAll.mockResolvedValue({
      'friendship_request:target-1:actor-1': {
        actorId: 'actor-1',
        targetId: 'target-1',
        type: 'friendship_request',
      },
    });
    getUsers.mockResolvedValue({
      'actor-1': {
        id: 'actor-1',
        firstName: 'An',
        lastName: 'Tran',
        avatarUrl: 'avatar-1',
      },
    });

    await service.flushRecentActivities();

    expect(sendNotification).toHaveBeenCalledWith({
      id: expect.any(String),
      eventType: 'friendship_request',
      payload: {
        targetType: NotiTargetType.USER,
        actorName: 'Tran An',
        actorAvatar: 'avatar-1',
        targetId: 'target-1',
        content: '',
      },
    });
    expect(acknowledgeProcessingActivities).toHaveBeenCalledWith([
      'friendship_request:target-1:actor-1',
    ]);
    expect(requeueProcessingActivities).toHaveBeenCalledWith([]);

    const firstRequestId = sendNotification.mock.calls[0][0].id;
    await service.flushRecentActivities();
    const secondRequestId = sendNotification.mock.calls[1][0].id;
    expect(secondRequestId).toBe(firstRequestId);
  });

  it('should requeue failed notifications and drop activities with missing actors', async () => {
    snapshotAndGetAll.mockResolvedValue({
      'friendship_request:target-1:actor-1': {
        actorId: 'actor-1',
        targetId: 'target-1',
        type: 'friendship_request',
      },
      'friendship_accept:target-2:actor-2': {
        actorId: 'actor-2',
        targetId: 'target-2',
        type: 'friendship_accept',
      },
    });
    getUsers.mockResolvedValue({
      'actor-1': {
        id: 'actor-1',
        firstName: 'An',
        lastName: 'Tran',
        avatarUrl: 'avatar-1',
      },
    });
    sendNotification.mockRejectedValueOnce(new Error('notification unavailable'));

    await service.flushRecentActivities();

    expect(acknowledgeProcessingActivities).toHaveBeenCalledWith([
      'friendship_accept:target-2:actor-2',
    ]);
    expect(requeueProcessingActivities).toHaveBeenCalledWith([
      {
        actorId: 'actor-1',
        targetId: 'target-1',
        type: 'friendship_request',
      },
    ]);
  });
});
