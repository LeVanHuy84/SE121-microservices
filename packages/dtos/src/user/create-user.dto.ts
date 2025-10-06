import { IsEmail, IsOptional, IsString } from "class-validator";

export class CreateUserDTO {
  @IsString()
  id: string;

  @IsEmail()
  email: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  avatarUrl?: string;

  @IsOptional()
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
