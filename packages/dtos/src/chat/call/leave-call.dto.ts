import { IsString } from 'class-validator';

export class LeaveCallDTO {
  @IsString()
  callId: string;
}
