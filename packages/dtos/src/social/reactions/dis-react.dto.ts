import { IsEnum, IsUUID } from 'class-validator';
import { TargetType } from '../enums/social.enum';

export class DisReactDTO {
  @IsUUID()
  targetId: string;

  @IsEnum(TargetType)
  targetType: TargetType;
}
