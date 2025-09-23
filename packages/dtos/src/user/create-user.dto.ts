import { IsEmail, IsOptional, IsString } from "class-validator";

export class CreateUserDTO {
  @IsEmail()
  email: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  clerkId: string;

  @IsOptional()
  avatarUrl?: string;

  @IsOptional()
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
