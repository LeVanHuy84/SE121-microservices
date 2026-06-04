import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';

export class DndSettingsDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  from?: string;

  @IsString()
  @IsOptional()
  to?: string;
}

export class UserPreferenceSettingsDto {
  @IsBoolean()
  @IsOptional()
  pushMentions?: boolean;

  @IsBoolean()
  @IsOptional()
  pushMessages?: boolean;

  @IsBoolean()
  @IsOptional()
  pushGroupMessages?: boolean;

  @IsBoolean()
  @IsOptional()
  pushFriendRequests?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => DndSettingsDto)
  doNotDisturb?: DndSettingsDto;
}

export class UpdateUserPreferenceDto {
  @IsString()
  userId: string;
  
  @IsOptional()
  @ValidateNested()
  @Type(() => UserPreferenceSettingsDto)
  settings?: UserPreferenceSettingsDto;
}
