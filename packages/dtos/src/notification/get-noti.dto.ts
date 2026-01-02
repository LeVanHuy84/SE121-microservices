import { NotificationPayload } from './create-noti.dto';

export class NotificationResponseDto {
  _id: string;
  userId: string;
  type: string;
  payload: NotificationPayload;
  status: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}
