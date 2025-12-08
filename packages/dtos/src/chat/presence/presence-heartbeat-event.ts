export type PresenceHeartbeatEvent = {
  type: 'HEARTBEAT';
  userId: string;
  serverId: string;
  ts?: number;
};
