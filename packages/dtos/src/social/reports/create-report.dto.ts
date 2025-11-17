import { IsEnum, IsString, IsUUID } from 'class-validator';
import { TargetType } from '../enums/social.enum';

export class CreateReportDTO {
  @IsString()
  targetId: string;

  @IsEnum(TargetType)
  targetType: TargetType;

  @IsString()
  reason: string;
}
