import { IsOptional } from 'class-validator';

export class DashboardQueryDTO {
  @IsOptional()
  range?: '7d' | '30d' | '90d';
}
