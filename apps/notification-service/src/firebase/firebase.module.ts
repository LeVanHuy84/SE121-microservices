import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { DeviceToken, DeviceTokenSchema } from 'src/mongo/schema/device-token.schema';
import { DeviceTokenController } from './device-token.controller';
import { DeviceTokenService } from './device-token.service';
import { FirebaseService } from './firebase.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: DeviceToken.name, schema: DeviceTokenSchema },
    ]),
  ],
  controllers: [DeviceTokenController],
  providers: [FirebaseService, DeviceTokenService],
  exports: [FirebaseService, DeviceTokenService],
})
export class FirebaseModule {}
