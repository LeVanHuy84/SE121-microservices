import { IsEmail, IsEnum, IsString } from 'class-validator';
import { SystemRole } from '../enums';

export class CreateSystemUserDTO {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEnum(SystemRole)
  role: SystemRole;
}
