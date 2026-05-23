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

    streamProvider = {
      issueUserToken: jest.fn().mockResolvedValue('user-token'),
    };

    service = new CallMediaService(streamProvider as any);
  });

  it('issues generic user token', async () => {
    const result = await service.issueUserMediaToken('user-1');

    expect(result.token).toBe('user-token');
    expect(streamProvider.issueUserToken).toHaveBeenCalledWith('user-1');
  });
});
