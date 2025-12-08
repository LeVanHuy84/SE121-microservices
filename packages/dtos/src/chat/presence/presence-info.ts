export type PresenceStatus = 'online' | 'offline';

export interface PresenceInfo {
  status: PresenceStatus;
  lastSeen: number | null; // timestamp (ms)
  serverId?: string | null;
}
