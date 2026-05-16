import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RequestCallMediaTokenDTO {
  @IsString()
  callId: string;

  @IsOptional()
  @IsBoolean()
  preferAudioOnly?: boolean;
}
