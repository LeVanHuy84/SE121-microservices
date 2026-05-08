import { LogType } from '../../log';

export class LogEventPayload {
  actorId: string;
  targetId: string;
  logType: LogType;
  action: string;
  detail: string;
  createdAt: Date;
}
