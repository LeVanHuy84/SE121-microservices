import { IsOptional, IsString } from 'class-validator';

export class SearchPostDto {
  @IsString()
  query: string;

  @IsOptional()
  cursor?: string;

  @IsOptional()
  size?: number = 10;

  @IsOptional()
  userId?: string;
  @IsOptional()
  groupId?: string;
  @IsOptional()
  emotion?: string;
}
