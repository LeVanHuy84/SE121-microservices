import { IsString } from 'class-validator';

export class AcceptCallDTO {
  @IsString()
  callId: string;
}
