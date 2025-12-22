import { Type } from 'class-transformer';

export class DashboardQueryDTO {
  @Type(() => Date)
  from: Date;

  @Type(() => Date)
  to: Date;
}
