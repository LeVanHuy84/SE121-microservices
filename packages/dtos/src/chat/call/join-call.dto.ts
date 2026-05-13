import { IsString } from 'class-validator';

export class JoinCallDTO {
  @IsString()
  callId: string;
}
