export type PresenceHeartbeatEvent = {
  type: 'HEARTBEAT';
  userId: string;
  serverId: string;
  connectionId?: string;
  ts?: number;
};
