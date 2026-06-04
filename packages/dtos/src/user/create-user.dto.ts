import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const normalizeInterestTags = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : value.split(',');
          } catch {
            return value.split(',');
          }
        })()
      : [];

  const normalized = rawValues
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)] : [];
};

export class CreateUserDTO {
  @IsString()
  id: string;

  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  school?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeInterestTags(value))
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  interests?: string[];

  @IsOptional()
  @IsString()
  role?: string;
}
