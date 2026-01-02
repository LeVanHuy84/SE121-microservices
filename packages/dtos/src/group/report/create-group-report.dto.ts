import { IsString } from 'class-validator';

export class CreateGroupReportDTO {
  @IsString()
  reason: string;
}
