import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  controllers: [UserController],
  providers: [UserService],
  imports: [
    DrizzleModule,
    ClientsModule.register([
      {
        name: 'SOCIAL_SERVICE',
        transport: Transport.REDIS,
        options: {
          host: 'localhost',
          port: 6379,
        },
      },
    ]),
  ],
})
export class UserModule {}
