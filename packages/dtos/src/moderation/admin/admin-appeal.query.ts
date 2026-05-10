import { IsOptional } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { AppealStatus } from '../enums';

export class AdminAppealQuery extends PaginationDTO {
  @IsOptional()
  status?: AppealStatus;
}
