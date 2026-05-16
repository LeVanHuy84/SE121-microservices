// Mock @stream-io/node-sdk BEFORE any import that touches it
jest.mock('@stream-io/node-sdk', () => ({
  StreamClient: jest.fn().mockImplementation(() => ({})),
}));

import { CallMediaService } from './call-media.service';
import { CallSessionStatus } from '@repo/dtos';

describe('CallMediaService', () => {
  let callService: any;
  let streamProvider: any;
  let conversationModel: any;
  let service: CallMediaService;

  beforeEach(() => {
    jest.clearAllMocks();

    callService = {
      getAuthorizedCallForUser: jest.fn(),
    };

    streamProvider = {
      issueParticipantToken: jest.fn().mockResolvedValue({
        token: 'tok',
        wsUrl: 'wss://stream.io',
        roomName: 'default:call-1',
        participantIdentity: 'user-1',
        callId: 'call-1',
        conversationId: 'conv-1',
        expiresAt: new Date(),
        audioOnly: false,
        iceServers: [],
        policy: {
          participantLimit: 10,
          moderatorUserIds: ['user-1'],
          screenShareAllowed: true,
          screenShareModeratorOnly: true,
        },
      }),
    };

    conversationModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ _id: 'conv-1', admins: [] }),
      }),
    };

    service = new CallMediaService(callService, streamProvider, conversationModel as any);
  });

  it('issues token for an active call', async () => {
    callService.getAuthorizedCallForUser.mockResolvedValue({
      _id: 'call-1',
      status: CallSessionStatus.ACCEPTED,
      initiatorId: 'user-1',
      participants: ['user-1', 'user-2'],
    });

    const result = await service.issueCallMediaToken('user-1', {
      callId: 'call-1',
    });

    expect(result.token).toBe('tok');
    expect(streamProvider.issueParticipantToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('throws when call is not ACCEPTED', async () => {
    callService.getAuthorizedCallForUser.mockResolvedValue({
      _id: 'call-1',
      status: CallSessionStatus.RINGING,
    });

    await expect(
      service.issueCallMediaToken('user-1', { callId: 'call-1' }),
    ).rejects.toThrow('Call is not active');
  });
});
