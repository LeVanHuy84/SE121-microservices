import { IsNumber, IsObject, IsOptional, Min } from 'class-validator';

export class InternalMusicQueryDto {
  @IsOptional()
  @IsNumber()
  valenceMin?: number;

  @IsOptional()
  @IsNumber()
  valenceMax?: number;

  @IsOptional()
  @IsNumber()
  arousalMin?: number;

  @IsOptional()
  @IsNumber()
  arousalMax?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsObject()
  sortByDistanceTo?: {
    valence: number;
    arousal: number;
    weightValence?: number;
    weightArousal?: number;
  };

  @IsOptional()
  @IsNumber()
  offset?: number;
}
