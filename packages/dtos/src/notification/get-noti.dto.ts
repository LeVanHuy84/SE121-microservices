import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CursorPaginationDTO } from '../pagination/cursor-pagination.dto';
import { NotificationPayload } from './create-noti.dto';

export class GetNotificationQueryDto extends CursorPaginationDTO {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsBoolean()
  isRead?: boolean;
}
export class NotificationResponseDto {
  _id: string;
  userId: string;
  type: string;
  payload: NotificationPayload;
  status: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}
