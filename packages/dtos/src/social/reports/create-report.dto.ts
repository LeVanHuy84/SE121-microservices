import { IsEnum, IsString, IsUUID, Length } from 'class-validator';
import { TargetType } from '../enums/social.enum';

export class ReactDTO {
  @IsUUID()
  targetId: string;

  @IsEnum(TargetType)
  targetType: TargetType;

  @IsString()
  reason: string;
}
