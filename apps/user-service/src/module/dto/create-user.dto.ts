import { IsEmail, IsOptional, IsString } from "class-validator";

export class CreateUserDto {
  @IsEmail()
  email: string;


  @IsString()
  username: string;

  @IsString()
  fullName: string;

  @IsString()
  clerkId: string;

  @IsOptional()
  avatar?: string;

  @IsOptional()
  coverImage?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
