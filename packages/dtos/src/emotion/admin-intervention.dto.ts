import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';



export enum TargetRiskLevel {
  MILD_STRESS = 'MILD_STRESS',
  MODERATE_RISK = 'MODERATE_RISK',
  HIGH_RISK = 'HIGH_RISK',
  CRISIS = 'CRISIS',
}

export enum InterventionMediaType {
  IMAGE = 'IMAGE',
  INFOGRAPHIC = 'INFOGRAPHIC',
  PDF_DOCUMENT = 'PDF_DOCUMENT',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  EXTERNAL_LINK = 'EXTERNAL_LINK',
}

// --- Intervention Resource DTOs (Medical Document Model) ---

export class CreateInterventionResourceDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsArray()
  @IsEnum(TargetRiskLevel, { each: true })
  targetRiskLevels: TargetRiskLevel[];

  @IsEnum(InterventionMediaType)
  mediaType: InterventionMediaType;

  @IsString()
  @IsNotEmpty()
  mediaUrl: string;

  @IsOptional()
  @IsString()
  sourceOrganization?: string; // e.g., "Bộ Y Tế", "WHO", "Viện Sức Khỏe Tinh Thần"

  @IsOptional()
  @IsString()
  referenceUrl?: string; // Link bài viết / tài liệu y khoa chính thức

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;
}

export class UpdateInterventionResourceDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(TargetRiskLevel, { each: true })
  targetRiskLevels?: TargetRiskLevel[];

  @IsOptional()
  @IsEnum(InterventionMediaType)
  mediaType?: InterventionMediaType;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  sourceOrganization?: string;

  @IsOptional()
  @IsString()
  referenceUrl?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;
}

// --- Emergency Hotline DTOs ---

export class OperatingHoursConfigDto {
  @IsOptional()
  @IsBoolean()
  is247?: boolean;

  @IsOptional()
  @IsString()
  startTime?: string; // Format HH:mm e.g., "08:00"

  @IsOptional()
  @IsString()
  endTime?: string; // Format HH:mm e.g., "20:00"

  @IsOptional()
  @IsArray()
  daysOfWeek?: number[]; // [1..7] where 1 is Monday

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  displayNote?: string;
}

export class CreateEmergencyHotlineDto {
  @IsString()
  @IsNotEmpty()
  organizationName: string;

  @IsString()
  @IsNotEmpty()
  hotlineNumber: string;

  @IsOptional()
  @IsBoolean()
  is247?: boolean;

  @IsOptional()
  @IsString()
  operatingHours?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OperatingHoursConfigDto)
  operatingHoursConfig?: OperatingHoursConfigDto;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  displayOrder?: number;
}

export class UpdateEmergencyHotlineDto {
  @IsOptional()
  @IsString()
  organizationName?: string;

  @IsOptional()
  @IsString()
  hotlineNumber?: string;

  @IsOptional()
  @IsBoolean()
  is247?: boolean;

  @IsOptional()
  @IsString()
  operatingHours?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OperatingHoursConfigDto)
  operatingHoursConfig?: OperatingHoursConfigDto;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  displayOrder?: number;
}
