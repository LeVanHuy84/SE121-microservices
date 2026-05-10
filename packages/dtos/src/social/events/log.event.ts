import { LogType } from '../../log';

export class LogEventPayload {
  actorId: string;
  targetId: string;
  action: string;
  detail: string;
  createdAt: Date;
}

export class LogEvent {
  type: LogType;
  payload: LogEventPayload;
}
