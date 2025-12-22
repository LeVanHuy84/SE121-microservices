import { Type } from 'class-transformer';
import { IsOptional } from 'class-validator';

export class DashboardQueryDTO {
  @IsOptional()
  @Type(() => Date)
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  to?: Date;
}
