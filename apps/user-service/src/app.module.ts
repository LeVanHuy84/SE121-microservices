import { Module } from '@nestjs/common';
import { UsersController } from './modules/users/users.controller';

@Module({
  imports: [],
  controllers: [UsersController],
})
export class AppModule { }
