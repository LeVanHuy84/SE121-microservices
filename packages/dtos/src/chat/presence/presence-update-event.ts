export type PresenceUpdateEvent = {
  type: 'PRESENCE_UPDATE';
  userId: string;
  status: 'online' | 'offline';
  lastSeen: number | null;
};