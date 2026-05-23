export class CallIceServerDTO {
  urls: string[];
  username?: string;
  credential?: string;
}

export class CallRoomPolicyDTO {
  participantLimit: number;
  moderatorUserIds: string[];
  screenShareAllowed: boolean;
  screenShareModeratorOnly: boolean;
}

export class CallMediaTokenResponseDTO {
  token: string;
  wsUrl: string;
  roomName: string;
  participantIdentity: string;
  callId: string;
  conversationId: string;
  expiresAt: Date;
  audioOnly: boolean;
  iceServers: CallIceServerDTO[];
  policy: CallRoomPolicyDTO;
}
