import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { MusicGenre } from '../enum';

export class MusicFeatureQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(MusicGenre)
  genre?: MusicGenre;
}
