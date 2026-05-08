import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AppealStatus } from '../enums';

export class CreateAdminReviewAppealDTO {
  @IsEnum(AppealStatus)
  status: AppealStatus;

  @IsString()
  @IsOptional()
  reviewNote?: string;
}
