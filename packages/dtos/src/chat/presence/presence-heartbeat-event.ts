export type PresenceHeartbeatEvent = {
  type: "HEARTBEAT";
  userId: string;
  serverId: string;
  connectionId?: string;
  ts?: number;
};

export type PresenceDisconnectEvent = {
  type: "DISCONNECT";
  userId: string;
  serverId: string;
  connectionId: string;
  ts?: number;
};
