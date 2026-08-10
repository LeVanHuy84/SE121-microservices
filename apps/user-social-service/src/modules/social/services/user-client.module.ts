import { Module } from '@nestjs/common';
import { UserClientService } from './user-client.service';
import { UserModule } from '../../user/user.module';

@Module({
  imports: [
    UserModule,
  ],
  providers: [UserClientService],
  exports: [UserClientService],
})
export class UserClientModule {}
