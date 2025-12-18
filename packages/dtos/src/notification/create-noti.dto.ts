import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested
} from 'class-validator';
import { ChannelNotification } from './enums/channel-notication.enum';

class MetaDto {
  @IsOptional()
  @IsNumber()
  maxRetries?: number;

  @IsOptional()
  @IsNumber()
  priority?: number;

  // Cho phép thêm key-value tùy ý
  [k: string]: any;
}

export class CreateNotificationDto {
  @IsOptional()
  @IsString()
  requestId?: string; // for idempotency

  @IsString()
  userId: string;

  @IsString()
  type: string;

  @IsOptional()
  payload?: any;

  @IsArray()
  @IsEnum(ChannelNotification, {each: true})
  channels: ChannelNotification[]; // override preference

  @IsOptional()
  @IsISO8601()
  sendAt?: Date; // ISO string for scheduling

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MetaDto)
  meta?: MetaDto;
}
