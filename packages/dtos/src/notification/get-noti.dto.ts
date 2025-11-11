export class NotificationResponseDto {
  _id: string;
  userId: string;
  type: string;
  payload: any;
  status: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}