// Mock @stream-io/node-sdk BEFORE any import that touches it
jest.mock('@stream-io/node-sdk', () => ({
  StreamClient: jest.fn().mockImplementation(() => ({})),
}));

import { CallService } from './call.service';
import { CallSessionStatus, CallEndReason } from '@repo/dtos';
import { Types } from 'mongoose';

const CALL_ID = new Types.ObjectId().toString();
const CONV_ID = new Types.ObjectId().toString();
const MSG_ID = new Types.ObjectId().toString();
const USER_1 = 'user-1';
const USER_2 = 'user-2';

describe('CallService', () => {
  const session = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const connection = {
    startSession: jest.fn().mockResolvedValue(session),
  };

  const createQuery = (result: any) => ({
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  });

  const createSaveableDoc = (data: any) => {
    const doc: any = {
      ...data,
      toObject: () => ({ ...doc }),
    };
    doc.save = jest.fn().mockImplementation(async () => doc);
    return doc;
  };

  let callSessionModel: any;
  let conversationModel: any;
  let messageModel: any;
  let redis: any;
  let outboxService: any;
  let configService: any;
  let chatPushService: any;
  let userClientService: any;
  let streamProvider: any;

  const createService = () =>
    new CallService(
      callSessionModel,
      conversationModel,
      messageModel,
      redis,
      outboxService,
      connection as any,
      configService,
      chatPushService,
      userClientService,
      streamProvider,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    connection.startSession.mockResolvedValue(session);

    streamProvider = {
      registerCall: jest.fn().mockResolvedValue(undefined),
      issueUserToken: jest.fn().mockResolvedValue('token'),
      endCallOnStream: jest.fn().mockResolvedValue(undefined),
      getActiveParticipantsCount: jest.fn().mockResolvedValue(0),
    };

    callSessionModel = Object.assign(
      jest.fn().mockImplementation((data: any) => {
        const doc = createSaveableDoc({ ...data, _id: CALL_ID });
        return doc;
      }),
      {
        findById: jest.fn(),
        exists: jest.fn(),
        updateOne: jest.fn().mockResolvedValue(undefined),
        find: jest.fn(),
      },
    );

    conversationModel = {
      findById: jest.fn(),
    };

    messageModel = Object.assign(
      jest.fn().mockImplementation((data: any) => {
        const doc = createSaveableDoc({ ...data, _id: MSG_ID });
        doc.save = jest.fn().mockResolvedValue(doc);
        return doc;
      }),
      {},
    );

    redis = {
      zadd: jest.fn().mockResolvedValue(undefined),
      zrem: jest.fn().mockResolvedValue(undefined),
      scard: jest.fn().mockResolvedValue(0),
      sadd: jest.fn().mockResolvedValue(undefined),
      srem: jest.fn().mockResolvedValue(undefined),
      expire: jest.fn().mockResolvedValue(undefined),
      eval: jest.fn().mockResolvedValue([]),
    };

    outboxService = {
      enqueueChatEvent: jest.fn().mockResolvedValue(undefined),
      flushPendingChatEvents: jest.fn().mockResolvedValue(undefined),
      clearPendingChatEvents: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    chatPushService = {
      sendCallPush: jest.fn().mockResolvedValue(undefined),
      sendMessagePush: jest.fn().mockResolvedValue(undefined),
      sendCallCancelPush: jest.fn().mockResolvedValue(undefined),
    };

    userClientService = {
      getUserInfo: jest.fn().mockResolvedValue({
        firstName: 'John',
        lastName: 'Doe',
        avatarUrl: 'http://avatar.com',
      }),
    };
  });

  // ─── helpers ───────────────────────────────────────────────────

  const makeConv = (overrides: any = {}) =>
    createSaveableDoc({
      _id: CONV_ID,
      participants: [USER_1, USER_2],
      isGroup: false,
      activeCallId: null,
      lastCallAt: null,
      lastMessage: null,
      ...overrides,
    });

  const makeCall = (overrides: any = {}) =>
    createSaveableDoc({
      _id: CALL_ID,
      conversationId: CONV_ID,
      initiatorId: USER_1,
      participants: [USER_1, USER_2],
      isGroupCall: false,
      maxParticipants: 2,
      type: 'audio',
      status: CallSessionStatus.RINGING,
      startedAt: null,
      endedAt: null,
      endReason: null,
      ringTimeoutAt: new Date(Date.now() + 30_000),
      reconnectDeadlineAt: null,
      callMessageId: null,
      ...overrides,
    });

  // ─── getCallById ──────────────────────────────────────────────

  describe('getCallById', () => {
    it('throws on invalid ObjectId', async () => {
      const service = createService();
      await expect(service.getCallById('not-valid')).rejects.toThrow(
        'Invalid call id',
      );
    });

    it('throws when call not found', async () => {
      const service = createService();
      callSessionModel.findById.mockReturnValue(createQuery(null));
      await expect(service.getCallById(CALL_ID)).rejects.toThrow(
        'Call session not found',
      );
    });
  });

  // ─── createCall ───────────────────────────────────────────────

  describe('createCall', () => {
    it('creates a call in RINGING status and updates conversation', async () => {
      const service = createService();
      const conv = makeConv();
      conversationModel.findById.mockReturnValue(createQuery(conv));
      callSessionModel.exists.mockReturnValue({
        session: jest.fn().mockReturnValue(null),
      });

      const result = await service.createCall(USER_1, {
        conversationId: CONV_ID,
        type: 'audio',
      });

      expect(result.status).toBe(CallSessionStatus.RINGING);
      expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
        'call.created',
        expect.anything(),
        expect.any(String),
        session,
      );
      expect(redis.zadd).toHaveBeenCalled();

      // Wait for async push trigger
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(chatPushService.sendCallPush).toHaveBeenCalled();
    });

    it('throws when user is busy in another call', async () => {
      const service = createService();
      const conv = makeConv();
      conversationModel.findById.mockReturnValue(createQuery(conv));

      // 1. hasActiveCallInConversation -> null
      // 2. recipientHasActiveCall -> null
      // 3. userHasActiveCall -> true
      callSessionModel.exists
        .mockReturnValueOnce({ session: jest.fn().mockReturnValue(null) })
        .mockReturnValueOnce({ session: jest.fn().mockReturnValue(null) })
        .mockReturnValueOnce({
          session: jest.fn().mockReturnValue({ _id: 'other-call' }),
        });

      await expect(
        service.createCall(USER_1, { conversationId: CONV_ID, type: 'audio' }),
      ).rejects.toThrow('busy in another call');
    });

    it('throws when user is not in conversation', async () => {
      const service = createService();
      const conv = makeConv({ participants: [USER_2, 'user-3'] });
      conversationModel.findById.mockReturnValue(createQuery(conv));

      await expect(
        service.createCall(USER_1, { conversationId: CONV_ID, type: 'audio' }),
      ).rejects.toThrow('You are not in this conversation');
    });

    it('throws when conversation already has an active call', async () => {
      const service = createService();
      const conv = makeConv();
      conversationModel.findById.mockReturnValue(createQuery(conv));
      callSessionModel.exists.mockReturnValue({
        session: jest.fn().mockReturnValue({ _id: 'existing' }),
      });

      await expect(
        service.createCall(USER_1, { conversationId: CONV_ID, type: 'audio' }),
      ).rejects.toThrow('Conversation already has an active call');
    });
  });

  // ─── acceptCall ───────────────────────────────────────────────

  describe('acceptCall', () => {
    it('transitions RINGING → ACCEPTED', async () => {
      const service = createService();
      const call = makeCall({ status: CallSessionStatus.RINGING });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(createQuery(makeConv()));

      const result = await service.acceptCall(USER_2, { callId: CALL_ID });

      expect(result.status).toBe(CallSessionStatus.ACCEPTED);
      expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
        'call.accepted',
        expect.objectContaining({ callId: expect.any(String) }),
        expect.any(String),
        session,
      );
    });

    it('is idempotent — returns existing when already ACCEPTED', async () => {
      const service = createService();
      const call = makeCall({ status: CallSessionStatus.ACCEPTED });
      callSessionModel.findById.mockReturnValue(createQuery(call));

      const result = await service.acceptCall(USER_2, { callId: CALL_ID });

      expect(result.status).toBe(CallSessionStatus.ACCEPTED);
      expect(outboxService.enqueueChatEvent).not.toHaveBeenCalled();
    });

    it('throws when call is not in RINGING state', async () => {
      const service = createService();
      const call = makeCall({ status: CallSessionStatus.ENDED });
      callSessionModel.findById.mockReturnValue(createQuery(call));

      await expect(
        service.acceptCall(USER_2, { callId: CALL_ID }),
      ).rejects.toThrow('Call is not in ringing state');
    });
  });

  // ─── rejectCall ───────────────────────────────────────────────

  describe('rejectCall', () => {
    it('callee rejects → REJECTED', async () => {
      const service = createService();
      const call = makeCall();
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(createQuery(makeConv()));

      const result = await service.rejectCall(USER_2, { callId: CALL_ID });

      expect(result.status).toBe(CallSessionStatus.REJECTED);
    });

    it('caller rejects own call → CANCELLED', async () => {
      const service = createService();
      const call = makeCall({ initiatorId: USER_1 });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(createQuery(makeConv()));

      const result = await service.rejectCall(USER_1, { callId: CALL_ID });

      expect(result.status).toBe(CallSessionStatus.CANCELLED);
    });

    it('is idempotent for REJECTED state', async () => {
      const service = createService();
      const call = makeCall({ status: CallSessionStatus.REJECTED });
      callSessionModel.findById.mockReturnValue(createQuery(call));

      const result = await service.rejectCall(USER_2, { callId: CALL_ID });

      expect(result.status).toBe(CallSessionStatus.REJECTED);
      expect(outboxService.enqueueChatEvent).not.toHaveBeenCalled();
    });

    it('throws when call is not RINGING', async () => {
      const service = createService();
      const call = makeCall({ status: CallSessionStatus.ACCEPTED });
      callSessionModel.findById.mockReturnValue(createQuery(call));

      await expect(
        service.rejectCall(USER_2, { callId: CALL_ID }),
      ).rejects.toThrow('Call is not in ringing state');
    });
  });

  // ─── endCall ──────────────────────────────────────────────────

  describe('endCall', () => {
    it('ends ACCEPTED call → ENDED with duration', async () => {
      const service = createService();
      const startedAt = new Date(Date.now() - 60_000);
      const call = makeCall({ status: CallSessionStatus.ACCEPTED, startedAt });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(createQuery(makeConv()));

      const result = await service.endCall(USER_1, { callId: CALL_ID });

      expect(result.status).toBe(CallSessionStatus.ENDED);
      expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
        'call.ended',
        expect.objectContaining({ durationSec: expect.any(Number) }),
        expect.any(String),
        session,
      );
    });

    it('cancels RINGING call → CANCELLED', async () => {
      const service = createService();
      const call = makeCall({ status: CallSessionStatus.RINGING });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(createQuery(makeConv()));

      const result = await service.endCall(USER_1, { callId: CALL_ID });

      expect(result.status).toBe(CallSessionStatus.CANCELLED);
    });

    it('is idempotent for terminal states', async () => {
      const service = createService();
      const call = makeCall({ status: CallSessionStatus.ENDED });
      callSessionModel.findById.mockReturnValue(createQuery(call));

      const result = await service.endCall(USER_1, { callId: CALL_ID });

      expect(result.status).toBe(CallSessionStatus.ENDED);
      expect(outboxService.enqueueChatEvent).not.toHaveBeenCalled();
    });
  });

  // ─── markMissedCallBySystem ───────────────────────────────────

  describe('markMissedCallBySystem', () => {
    it('marks expired ringing call as MISSED', async () => {
      const service = createService();
      const call = makeCall({
        status: CallSessionStatus.RINGING,
        ringTimeoutAt: new Date(Date.now() - 1000),
      });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(createQuery(makeConv()));

      const ok = await service.markMissedCallBySystem(CALL_ID);

      expect(ok).toBe(true);
    });
  });

  // ─── markReconnectTimeoutCallBySystem ─────────────────────────

  describe('markReconnectTimeoutCallBySystem', () => {
    it('ends accepted call on reconnect timeout', async () => {
      const service = createService();
      const call = makeCall({
        status: CallSessionStatus.ACCEPTED,
        startedAt: new Date(Date.now() - 120_000),
        reconnectDeadlineAt: new Date(Date.now() - 1000),
      });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(createQuery(makeConv()));

      const ok = await service.markReconnectTimeoutCallBySystem(CALL_ID);

      expect(ok).toBe(true);
    });
  });

  // ─── Group call: joinCall ─────────────────────────────────────

  describe('joinCall', () => {
    it('adds user to online set and emits participantJoined', async () => {
      const service = createService();
      const call = makeCall({
        status: CallSessionStatus.ACCEPTED,
        isGroupCall: true,
        maxParticipants: 10,
      });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      redis.scard.mockResolvedValue(3);

      const result = await service.joinCall(USER_2, { callId: CALL_ID });

      expect(redis.sadd).toHaveBeenCalled();
      expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
        'call.participantJoined',
        expect.objectContaining({ userId: USER_2 }),
        expect.any(String),
      );
      expect(result.userId).toBe(USER_2);
    });

    it('throws CALL_ROOM_FULL when at capacity', async () => {
      const service = createService();
      const call = makeCall({
        status: CallSessionStatus.ACCEPTED,
        isGroupCall: true,
        maxParticipants: 5,
        participants: [USER_1, USER_2, 'user-3'],
      });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      redis.scard.mockResolvedValue(5);

      await expect(
        service.joinCall('user-3', { callId: CALL_ID }),
      ).rejects.toThrow('CALL_ROOM_FULL');
    });

    it('throws when call is not ACCEPTED', async () => {
      const service = createService();
      const call = makeCall({ status: CallSessionStatus.RINGING });
      callSessionModel.findById.mockReturnValue(createQuery(call));

      await expect(
        service.joinCall(USER_2, { callId: CALL_ID }),
      ).rejects.toThrow('Call is not joinable');
    });
  });

  // ─── Group call: leaveCall ────────────────────────────────────

  describe('leaveCall', () => {
    it('removes user and schedules emptyRoomTimeout when last leaves', async () => {
      const service = createService();
      const call = makeCall({
        status: CallSessionStatus.ACCEPTED,
        isGroupCall: true,
      });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      redis.scard.mockResolvedValue(0);

      const result = await service.leaveCall(USER_2, { callId: CALL_ID });

      expect(redis.srem).toHaveBeenCalled();
      expect(redis.zadd).toHaveBeenCalled();
      expect(result.remainingParticipants).toBe(0);
    });
  });

  // ─── Group call: kickCallParticipant ──────────────────────────

  describe('kickCallParticipant', () => {
    it('initiator can kick', async () => {
      const service = createService();
      const call = makeCall({
        status: CallSessionStatus.ACCEPTED,
        isGroupCall: true,
        initiatorId: USER_1,
      });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(createQuery(makeConv()));

      const result = await service.kickCallParticipant(USER_1, {
        callId: CALL_ID,
        targetUserId: USER_2,
      });

      expect(result.targetUserId).toBe(USER_2);
    });

    it('group admin can kick', async () => {
      const service = createService();
      const call = makeCall({
        status: CallSessionStatus.ACCEPTED,
        isGroupCall: true,
        initiatorId: 'other-initiator',
        participants: ['other-initiator', USER_1, USER_2],
      });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(
        createQuery(makeConv({ admins: [USER_1] })),
      );

      const result = await service.kickCallParticipant(USER_1, {
        callId: CALL_ID,
        targetUserId: USER_2,
      });

      expect(result.targetUserId).toBe(USER_2);
    });

    it('throws when neither initiator nor admin', async () => {
      const service = createService();
      const call = makeCall({
        status: CallSessionStatus.ACCEPTED,
        isGroupCall: true,
        initiatorId: 'other-initiator',
      });
      callSessionModel.findById.mockReturnValue(createQuery(call));
      conversationModel.findById.mockReturnValue(
        createQuery(makeConv({ admins: [] })),
      );

      await expect(
        service.kickCallParticipant(USER_1, {
          callId: CALL_ID,
          targetUserId: USER_2,
        }),
      ).rejects.toThrow(
        'Only call initiator or group admins can kick participant',
      );
    });

    it('rejects kick in non-group call', async () => {
      const service = createService();
      const call = makeCall({ isGroupCall: false, initiatorId: USER_1 });
      callSessionModel.findById.mockReturnValue(createQuery(call));

      await expect(
        service.kickCallParticipant(USER_1, {
          callId: CALL_ID,
          targetUserId: USER_2,
        }),
      ).rejects.toThrow('Kick is only allowed in group call');
    });
  });

  // ─── Authorization guard ──────────────────────────────────────

  describe('authorization', () => {
    it('throws when user is not a call participant', async () => {
      const service = createService();
      const call = makeCall({ participants: [USER_1, USER_2] });
      callSessionModel.findById.mockReturnValue(createQuery(call));

      await expect(
        service.acceptCall('user-999', { callId: CALL_ID }),
      ).rejects.toThrow('You are not in this call');
    });
  });
});
