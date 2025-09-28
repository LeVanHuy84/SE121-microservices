import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENT } from 'src/constant';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: MICROSERVICES_CLIENT.USER_SERVICE,
        transport: Transport.REDIS,
        options: {
          host: 'localhost',
          port: 6379,
        },
      },
    ]),
  ],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
